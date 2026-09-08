/**
 * SessionDB —— 每个项目一个 SQLite 数据库，用于会话事件持久化与 FTS5 检索。
 *
 * 移植自 context-mode 的 session/db.ts 思路，但做了精简：
 *   - 使用 better-sqlite3（与源项目一致，支持 FTS5 BM25）。
 *   - 每个项目目录 hash 出一个 <16 hex>.db，存于 ~/.pi/context-mode/sessions/ 下，
 *     实现项目隔离（与源项目 Storage Root 约定对齐）。
 *   - FTS5 采用外部内容表 + 触发器自动同步，简化插入/清理路径。
 */

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface SessionEvent {
  type: string;
  category: string;
  data: string;
  priority: number;
  data_hash: string;
  project_dir?: string;
  attribution_source?: string;
  attribution_confidence?: number;
}

export interface StoredEvent extends SessionEvent {
  id: number;
  created_at: string;
}

export interface SessionStats {
  compact_count: number;
  started_at: string;
}

export interface ResumeRecord {
  snapshot: string;
  event_count: number;
  consumed: number;
  created_at: string;
}

export interface SearchResult {
  id: number;
  type: string;
  category: string;
  data: string;
  created_at: string;
}

// ~/.pi/context-mode/sessions —— 与源项目 pi 适配器（PiAdapter.getSessionDir()）对齐。
export function getSessionDir(): string {
  return join(homedir(), ".pi", "context-mode", "sessions");
}

export function resolveDbPath(projectDir: string, sessionsDir = getSessionDir()): string {
  const hash = createHash("sha256").update(projectDir).digest("hex").slice(0, 16);
  return join(sessionsDir, `${hash}.db`);
}

/** 生成事件的数据指纹，用于去重/统计。 */
export function dataHash(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/** 把 SQLite 的 UTC 时间（YYYY-MM-DD HH:MM:SS，无时区）解析为毫秒。 */
export function parseSqliteTimestampMs(value: string): number {
  const trimmed = value.trim();
  const sqliteUtc = trimmed.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/);
  const normalized = sqliteUtc
    ? `${sqliteUtc[1]}T${sqliteUtc[2]}${sqliteUtc[3] ?? ""}Z`
    : trimmed;
  return Date.parse(normalized);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  project_dir   TEXT NOT NULL DEFAULT '',
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  compact_count INTEGER NOT NULL DEFAULT 0,
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  category   TEXT NOT NULL,
  data       TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 1,
  data_hash  TEXT NOT NULL DEFAULT '',
  project_dir TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

CREATE TABLE IF NOT EXISTS resumes (
  session_id  TEXT PRIMARY KEY,
  snapshot    TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  consumed    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  type, category, data,
  content='events', content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, type, category, data)
  VALUES (new.id, new.type, new.category, new.data);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, type, category, data)
  VALUES ('delete', old.id, old.type, old.category, old.data);
END;

CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, type, category, data)
  VALUES ('delete', old.id, old.type, old.category, old.data);
  INSERT INTO events_fts(rowid, type, category, data)
  VALUES (new.id, new.type, new.category, new.data);
END;
`;

/** 转义 LIKE 模式里的 % / _ / \ 通配符，避免用户输入被当成通配符。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => "\\" + c);
}

export class SessionDB {
  private db: Database.Database;

  constructor(readonly dbPath: string) {
    mkdirSync(join(dbPath, ".."), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  ensureSession(sessionId: string, projectDir: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, project_dir, last_active_at)
         VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f','now'))
         ON CONFLICT(session_id) DO UPDATE SET last_active_at = excluded.last_active_at`,
      )
      .run(sessionId, projectDir);
  }

  insertEvent(
    sessionId: string,
    event: SessionEvent,
    projectDir = "",
  ): void {
    const hash = event.data_hash || dataHash(event.data);
    this.db
      .prepare(
        `INSERT INTO events (session_id, type, category, data, priority, data_hash, project_dir)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        event.type,
        event.category,
        event.data,
        event.priority ?? 1,
        hash,
        event.project_dir ?? projectDir,
      );
  }

  getEvents(
    sessionId: string,
    opts: { minPriority?: number; limit?: number } = {},
  ): StoredEvent[] {
    const { minPriority = 0, limit = 1000 } = opts;
    return this.db
      .prepare(
        `SELECT id, session_id, type, category, data, priority, data_hash, project_dir, created_at
         FROM events
         WHERE session_id = ? AND priority >= ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(sessionId, minPriority, limit) as StoredEvent[];
  }

  getEventCount(sessionId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE session_id = ?`)
      .get(sessionId) as { n: number };
    return row.n;
  }

  getSessionStats(sessionId: string): SessionStats | null {
    const row = this.db
      .prepare(`SELECT compact_count, started_at FROM sessions WHERE session_id = ?`)
      .get(sessionId) as { compact_count: number; started_at: string } | undefined;
    return row ?? null;
  }

  incrementCompactCount(sessionId: string): void {
    this.db
      .prepare(`UPDATE sessions SET compact_count = compact_count + 1 WHERE session_id = ?`)
      .run(sessionId);
  }

  /**
   * 检索当前会话事件。
   *
   * SQLite FTS5 不提供中文分词（本机构建没有 uniseg/icu），因此采用混合策略：
   *   - 连续 ≥3 字符的查询先走 trigram FTS5（CJK/英文子串匹配 + BM25 排序）；
   *   - 短查询、带空格或 FTS5 未命中时回退到 LIKE 子串匹配（结果按时间倒序）。
   */
  searchEvents(sessionId: string, query: string, limit = 20): SearchResult[] {
    const q = query.trim();
    if (!q) return [];

    const compact = q.replace(/\s+/g, "");
    if ([...compact].length >= 3) {
      const fts = this.db
        .prepare(
          `SELECT e.id, e.type, e.category, e.data, e.created_at
           FROM events_fts f
           JOIN events e ON e.id = f.rowid
           WHERE events_fts MATCH ? AND e.session_id = ?
           ORDER BY bm25(events_fts)
           LIMIT ?`,
        )
        .all(compact, sessionId, limit) as SearchResult[];
      if (fts.length > 0) return fts;
    }

    const like = `%${escapeLike(q)}%`;
    return this.db
      .prepare(
        `SELECT id, type, category, data, created_at FROM events
         WHERE session_id = ? AND data LIKE ? ESCAPE '\\'
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(sessionId, like, limit) as SearchResult[];
  }

  upsertResume(sessionId: string, snapshot: string, eventCount: number): void {
    this.db
      .prepare(
        `INSERT INTO resumes (session_id, snapshot, event_count, consumed, created_at)
         VALUES (?, ?, ?, 0, strftime('%Y-%m-%d %H:%M:%f','now'))
         ON CONFLICT(session_id) DO UPDATE SET
           snapshot = excluded.snapshot,
           event_count = excluded.event_count,
           consumed = 0,
           created_at = excluded.created_at`,
      )
      .run(sessionId, snapshot, eventCount);
  }

  getResume(sessionId: string): ResumeRecord | null {
    const row = this.db
      .prepare(
        `SELECT snapshot, event_count, consumed, created_at FROM resumes WHERE session_id = ?`,
      )
      .get(sessionId) as ResumeRecord | undefined;
    return row ?? null;
  }

  markResumeConsumed(sessionId: string): void {
    this.db.prepare(`UPDATE resumes SET consumed = 1 WHERE session_id = ?`).run(sessionId);
  }

  /** 清理超过 keepDays 天未活跃的会话（及其事件）。 */
  cleanupOldSessions(keepDays = 7): void {
    this.db
      .prepare(
        `DELETE FROM events WHERE session_id IN (
           SELECT session_id FROM sessions
           WHERE last_active_at IS NOT NULL
             AND last_active_at < strftime('%Y-%m-%d %H:%M:%f','now', ?)
         )`,
      )
      .run(`-${keepDays} days`);
    this.db
      .prepare(
        `DELETE FROM sessions
         WHERE last_active_at IS NOT NULL
           AND last_active_at < strftime('%Y-%m-%d %H:%M:%f','now', ?)`,
      )
      .run(`-${keepDays} days`);
    this.db.prepare(`DELETE FROM resumes WHERE session_id NOT IN (SELECT session_id FROM sessions)`).run();
  }
}

/** 当前项目数据库是否存在（用于 ctx-doctor 诊断）。 */
export function dbExists(dbPath: string): boolean {
  return existsSync(dbPath);
}

/** 导出 resolve 别名，供 index.ts 统一引用项目根。 */
export function defaultProjectDir(): string {
  return resolve(process.cwd());
}