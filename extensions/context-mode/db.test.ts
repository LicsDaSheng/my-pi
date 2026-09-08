import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionDB,
  dataHash,
  dbExists,
  parseSqliteTimestampMs,
  resolveDbPath,
} from "./db.js";

let dir: string;
let dbPath: string;
let db: SessionDB;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cm-db-"));
  dbPath = join(dir, "sessions.db");
  db = new SessionDB(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveDbPath / dataHash / parse", () => {
  it("项目目录哈希出 16 位十六进制文件名", () => {
    const path = resolveDbPath("/proj/a", dir);
    expect(path.startsWith(dir)).toBe(true);
    expect(path.endsWith(".db")).toBe(true);
    const base = join(path);
    const filename = base.slice(dir.length + 1);
    expect(filename).toMatch(/^[0-9a-f]{16}\.db$/);
  });

  it("dataHash 返回 16 位十六进制", () => {
    expect(dataHash("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("解析 SQLite UTC 时间戳", () => {
    const ms = parseSqliteTimestampMs("2026-09-07 10:00:00");
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBe(Date.parse("2026-09-07T10:00:00Z"));
  });

  it("dbExists 反映文件存在性", () => {
    expect(dbExists(dbPath)).toBe(true);
    expect(dbExists(join(dir, "nope.db"))).toBe(false);
  });
});

describe("SessionDB", () => {
  it("fresh 会话无事件", () => {
    db.ensureSession("s1", "/proj/a");
    expect(db.getEventCount("s1")).toBe(0);
    expect(db.getSessionStats("s1")?.compact_count).toBe(0);
  });

  it("插入并读取事件", () => {
    db.ensureSession("s1", "/proj/a");
    db.insertEvent("s1", { type: "file_write", category: "file", data: "a.ts", priority: 1, data_hash: dataHash("a.ts") });
    expect(db.getEventCount("s1")).toBe(1);
    expect(db.getEvents("s1")[0].data).toBe("a.ts");
  });

  it("getEvents 支持 minPriority 与 limit", () => {
    db.ensureSession("s1", "/proj/a");
    db.insertEvent("s1", { type: "goal", category: "goal", data: "A", priority: 4, data_hash: dataHash("A") });
    db.insertEvent("s1", { type: "file_write", category: "file", data: "a", priority: 1, data_hash: dataHash("a") });
    expect(db.getEvents("s1", { minPriority: 4 })).toHaveLength(1);
    expect(db.getEvents("s1", { limit: 1 })).toHaveLength(1);
  });

  it("FTS5 trigram 检索命中与未命中", () => {
    db.ensureSession("s1", "/proj/a");
    db.insertEvent("s1", { type: "goal", category: "goal", data: "重构订单模块", priority: 4, data_hash: dataHash("重构订单模块") });
    expect(db.searchEvents("s1", "订单模块")).toHaveLength(1); // 连续 ≥3 字符 → trigram
    expect(db.searchEvents("s1", "不存在的词xyz")).toHaveLength(0);
  });

  it("短查询与带空格查询回退到 LIKE", () => {
    db.ensureSession("s1", "/proj/a");
    db.insertEvent("s1", { type: "decision", category: "decision", data: "使用方案 B", priority: 3, data_hash: dataHash("使用方案 B") });
    expect(db.searchEvents("s1", "方案 B")).toHaveLength(1); // 带空格 → LIKE
    expect(db.searchEvents("s1", "方案")).toHaveLength(1); // 2 字符 → LIKE
  });

  it("检索仅限当前会话", () => {
    db.ensureSession("s1", "/proj/a");
    db.ensureSession("s2", "/proj/a");
    db.insertEvent("s1", { type: "goal", category: "goal", data: "目标A", priority: 4, data_hash: dataHash("目标A") });
    db.insertEvent("s2", { type: "goal", category: "goal", data: "目标B", priority: 4, data_hash: dataHash("目标B") });
    expect(db.searchEvents("s1", "目标B")).toHaveLength(0);
    expect(db.searchEvents("s2", "目标B")).toHaveLength(1);
  });

  it("续借快照 upsert / get / 消费", () => {
    db.ensureSession("s1", "/proj/a");
    expect(db.getResume("s1")).toBeNull();
    db.upsertResume("s1", "<snap/>", 3);
    expect(db.getResume("s1")?.consumed).toBe(0);
    expect(db.getResume("s1")?.event_count).toBe(3);
    db.markResumeConsumed("s1");
    expect(db.getResume("s1")?.consumed).toBe(1);
  });

  it("incrementCompactCount 递增", () => {
    db.ensureSession("s1", "/proj/a");
    db.incrementCompactCount("s1");
    db.incrementCompactCount("s1");
    expect(db.getSessionStats("s1")?.compact_count).toBe(2);
  });

  it("cleanupOldSessions 不清理近期会话", () => {
    db.ensureSession("s1", "/proj/a");
    db.insertEvent("s1", { type: "file_write", category: "file", data: "a.ts", priority: 1, data_hash: dataHash("a.ts") });
    db.cleanupOldSessions(7);
    expect(db.getEventCount("s1")).toBe(1);
  });
});