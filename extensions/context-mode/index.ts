/**
 * context-mode —— 当前项目（my-pi）的 pi 自包含扩展。
 *
 * 移植自 mksglu/context-mode 的 pi 适配器思路，仅保留与 pi 原生工具有关的部分：
 *   1. 会话连续性：把工具调用、用户目标/决策等事件写入 SQLite（含 FTS5），
 *      在 compaction 前生成续借快照，下一轮注入回上下文；
 *   2. 路由拦截：把 bash 里的内联 HTTP 客户端（fetch/curl/wget 等）拦下，避免
 *      原始响应体灌进上下文；
 *   3. think-in-code 引导锚：把大输出导向「写文件 + read/grep 抽需求片段」从
 *      根源上减少上下文占用；
 *   4. 命令：/ctx-stats、/ctx-doctor；
 *   5. 原生工具：ctx_search（供 LLM 在压缩后检索会话历史）。
 *
 * 不移植 claude code / codex / opencode 等其它平台适配，也不引入 MCP 沙盒服务器。
 */

import {
  defineTool,
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  SessionDB,
  dbExists,
  getSessionDir,
  parseSqliteTimestampMs,
  resolveDbPath,
} from "./db.js";
import { extractToolEvents, extractUserEvents } from "./extract.js";
import { buildResumeSnapshot } from "./snapshot.js";
import { evaluateCommand } from "./routing.js";

const MAX_ACTIVE_MEMORY_CHARS = 2000; // ~500 token，与源项目的 500-token 上限对齐。
const RETAIN_DAYS = 7;

/** 把事件 data 裁剪到安全长度，避免内存注入块超预算。 */
function trimData(data: string, max = 400): string {
  const codepoints = [...data];
  if (codepoints.length <= max) return data;
  return codepoints.slice(0, max).join("") + "…";
}

/**
 * think-in-code 引导锚。与源项目 Pi-1 锚对应，但按 pi 原生工具改写。
 * 保持精简：详细规则放在 skills/context-mode 里，这里只做每轮决策前的简短提醒。
 */
const ROUTING_ANCHOR = [
  "[context-mode] 即将执行命令/读文件/调 API 时提醒：",
  "大输出（日志/测试/diff/API/CLI 结果）先写到文件再 read/grep 只读需求片段；",
  "多文件统计解析写脚本只 console.log 结果；拿不准就写文件。回顾历史用 ctx_search。",
].join(" ");

const searchSchema = Type.Object({
  query: Type.String(),
});

type SearchParams = Static<typeof searchSchema>;

export default function contextMode(pi: ExtensionAPI): void {
  let db: SessionDB | null = null;
  let projectDir = "";
  let sessionId = "";
  let pendingContext = "";

  const getOrOpenDb = (pd: string): SessionDB => {
    if (!db) db = new SessionDB(resolveDbPath(pd));
    return db;
  };

  const resolveProjectDir = (ctx: { cwd?: string } | undefined): string => {
    const cwd = ctx?.cwd?.trim();
    return cwd || process.cwd();
  };

  const buildStatsText = (): string => {
    if (!db || !sessionId) return "context-mode: 无活跃会话";
    const stats = db.getSessionStats(sessionId);
    const count = db.getEventCount(sessionId);
    const lines = [
      "## context-mode stats (pi)",
      "",
      `- 会话：\`${sessionId.slice(0, 8)}…\``,
      `- 已捕获事件：${count}`,
      `- 压缩次数：${stats?.compact_count ?? 0}`,
    ];
    if (stats?.started_at) {
      const startedMs = parseSqliteTimestampMs(stats.started_at);
      if (Number.isFinite(startedMs)) {
        lines.push(`- 会话年龄：${Math.round((Date.now() - startedMs) / 60_000)}m`);
      }
    }
    return lines.join("\n");
  };

  // ── 1. session_start：初始化会话 ──────────────────────────

  pi.on("session_start", (event, ctx) => {
    try {
      const id = ctx?.sessionManager?.getSessionId?.();
      if (!id) return;
      sessionId = id;
      projectDir = resolveProjectDir(ctx);
      const d = getOrOpenDb(projectDir);
      d.ensureSession(sessionId, projectDir);
      d.cleanupOldSessions(RETAIN_DAYS);
    } catch {
      // 尽力而为，绝不破坏会话启动
    }
  });

  // ── 2. tool_call：路由拦截（bash 内联 HTTP 客户端）──────────

  pi.on("tool_call", (event) => {
    try {
      if (!isToolCallEventType("bash", event)) return;
      const decision = evaluateCommand(event.input.command ?? "");
      if (decision?.block) {
        return { block: true, reason: decision.reason };
      }
    } catch {
      // 路由失败放行
    }
  });

  // ── 3. tool_result：捕获工具调用事件 ───────────────────────

  pi.on("tool_result", (event) => {
    try {
      if (!sessionId || !db) return;
      const toolName = String(event.toolName ?? "");
      const params = (event.input ?? {}) as Record<string, unknown>;
      const result = (event.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => (c as { text?: string }).text ?? "")
        .join("\n");

      const events = extractToolEvents({
        toolName,
        params,
        result,
        isError: event.isError,
      });
      for (const ev of events) db.insertEvent(sessionId, ev, projectDir);
    } catch {
      // 会话捕获绝不破坏工具调用
    }
  });

  // ── 4. before_agent_start：注入锚 + 活跃记忆 + 续借快照 ─────

  pi.on("before_agent_start", (event, ctx) => {
    try {
      if (!ctx?.sessionManager?.getSessionId?.()) return;
      const id = ctx.sessionManager.getSessionId();
      const wasNewSession = sessionId !== id;
      sessionId = id;
      const pd = resolveProjectDir(ctx);
      if (wasNewSession || projectDir !== pd) {
        projectDir = pd;
        if (db) {
          try { db.close(); } catch { /* 尽力而为 */ }
          db = null;
        }
        db = new SessionDB(resolveDbPath(pd));
      }
      if (!db) return;

      // 从提示词抽取用户事件（goal / decision / user-prompt）。
      const prompt = String(event.prompt ?? "");
      if (prompt) {
        for (const ev of extractUserEvents(prompt)) {
          db.insertEvent(sessionId, ev, projectDir);
        }
      }

      const parts: string[] = [ROUTING_ANCHOR];

      // 活跃记忆：高优先级事件（goal=4 / decision=3 / file_search=3 等）。
      const activeEvents = db
        .getEvents(sessionId, { minPriority: 3, limit: 50 })
        .filter((e) => String(e.category ?? "") !== "role");
      if (activeEvents.length > 0) {
        const lines = ["<active_memory>"];
        let budget = MAX_ACTIVE_MEMORY_CHARS;
        for (const ev of activeEvents) {
          const line = `  <event type="${ev.type}" category="${ev.category}">${trimData(ev.data)}</event>`;
          if (line.length > budget) break;
          lines.push(line);
          budget -= line.length;
        }
        lines.push("</active_memory>");
        if (lines.length > 2) parts.push(lines.join("\n"));
      }

      // 续借快照：仅当存在且未消费时注入。
      const resume = db.getResume(sessionId);
      if (resume && !resume.consumed && resume.snapshot) {
        parts.push(resume.snapshot);
        db.markResumeConsumed(sessionId);
      }

      pendingContext = parts.join("\n\n");
    } catch {
      pendingContext = "";
    }
  });

  // ── 5. context：把注入内容作为消息追加到末尾 ────────────────

  pi.on("context", (event) => {
    try {
      if (!pendingContext) return;
      const ctxText = pendingContext;
      pendingContext = "";
      event.messages.push({
        role: "user",
        content: ctxText,
        timestamp: Date.now(),
      });
      return { messages: event.messages };
    } catch {
      // 尽力而为
    }
  });

  // ── 6. session_before_compact：构建续借快照 ────────────────

  pi.on("session_before_compact", () => {
    try {
      if (!sessionId || !db) return;
      const events = db.getEvents(sessionId);
      if (events.length === 0) return;
      const stats = db.getSessionStats(sessionId);
      const snapshot = buildResumeSnapshot(events, {
        compactCount: (stats?.compact_count ?? 0) + 1,
      });
      db.upsertResume(sessionId, snapshot, events.length);
    } catch {
      // 尽力而为
    }
  });

  // ── 7. session_compact：递增压缩计数 ───────────────────────

  pi.on("session_compact", () => {
    try {
      if (sessionId && db) db.incrementCompactCount(sessionId);
    } catch {
      // 尽力而为
    }
  });

  // ── 8. session_shutdown：清理并关闭数据库 ─────────────────

  pi.on("session_shutdown", () => {
    try {
      if (db) {
        db.cleanupOldSessions(RETAIN_DAYS);
        db.close();
      }
    } catch {
      // 尽力而为
    } finally {
      db = null;
      sessionId = "";
      projectDir = "";
      pendingContext = "";
    }
  });

  // ── 9. 命令 ─────────────────────────────────────────────

  const notify = (ctx: ExtensionCommandContext, text: string): void => {
    if (ctx.hasUI) ctx.ui.notify(text, "info");
  };

  pi.registerCommand("ctx-stats", {
    description: "查看 context-mode 会话统计",
    handler: async (_args, ctx) => {
      notify(ctx, buildStatsText());
    },
  });

  pi.registerCommand("ctx-doctor", {
    description: "运行 context-mode 诊断",
    handler: async (_args, ctx) => {
      const dbPath = projectDir ? resolveDbPath(projectDir) : getSessionDir();
      const lines = [
        "## ctx-doctor (pi)",
        "",
        `- 会话目录：\`${getSessionDir()}\``,
        `- 数据库路径：\`${dbPath}\``,
        `- 数据库存在：${projectDir ? dbExists(dbPath) : "n/a"}`,
        `- 会话 ID：\`${sessionId ? `${sessionId.slice(0, 8)}…` : "none"}\``,
        `- 项目目录：\`${projectDir || "n/a"}\``,
      ];
      if (db && sessionId) {
        const count = db.getEventCount(sessionId);
        const stats = db.getSessionStats(sessionId);
        const resume = db.getResume(sessionId);
        lines.push(`- 事件数：${count}`);
        lines.push(`- 压缩次数：${stats?.compact_count ?? 0}`);
        lines.push(
          `- 续借快照：${resume ? (resume.consumed ? "已消费" : "待注入") : "无"}`,
        );
      }
      notify(ctx, lines.join("\n"));
    },
  });

  // ── 10. 原生工具 ctx_search：让 LLM 能在压缩后检索会话历史 ──

  const ctxSearchTool = defineTool({
    name: "ctx_search",
    label: "搜索会话历史",
    description:
      "搜索当前 pi 会话历史事件（决策、目标、文件操作、错误、git 提交等），" +
      "用于在上下文压缩后恢复之前的状态。不要向用户重复询问已记录的内容，先检索。",
    promptSnippet: "Search prior session events (ctx_search)",
    parameters: searchSchema,
    async execute(_toolCallId, params: SearchParams) {
      if (!db || !sessionId) {
        return {
          content: [{ type: "text", text: "context-mode: 无活跃会话，无法检索。" }],
          details: {},
        };
      }
      const results = db.searchEvents(sessionId, params.query, 20);
      const text =
        results.length === 0
          ? `未检索到与「${params.query}」相关的会话历史。`
          : results.map((r) => `[${r.category}] ${trimData(r.data, 300)}`).join("\n");
      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });

  pi.registerTool(ctxSearchTool);
}