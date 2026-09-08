/**
 * 会话续借快照构建 —— 把存储的事件转换成一段紧凑的 XML 摘要，
 * 在 compact 之后注入回上下文，让下一个 LLM 能接上进度。
 *
 * 移植自 context-mode 的 session/snapshot.ts，但针对自包含版本做了裁剪：
 *   - 去掉跨平台 MCP 工具（ctx_*）的检索引用，改为在有需要时直接内嵌受限摘要；
 *   - 保留 how_to_search / goal / files / errors / decisions / git / environment /
 *     recent_user_messages 这些关键小节。
 */

import type { StoredEvent } from "./db.js";

export interface BuildSnapshotOpts {
  compactCount?: number;
  maxFiles?: number;
  maxRecentMessages?: number;
}

function escapeXML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, max: number): string {
  const codepoints = [...value];
  if (codepoints.length <= max) return value;
  return codepoints.slice(0, max).join("") + "…";
}

function buildGoalSection(goalEvents: StoredEvent[]): string {
  if (goalEvents.length === 0) return "";
  const last = goalEvents[goalEvents.length - 1];
  return [
    `  <session_goal>`,
    `  The active objective for this session. Keep working toward it until it is met; do not ask the user to restate it.`,
    `    ${escapeXML(last.data)}`,
    `  </session_goal>`,
  ].join("\n");
}

function buildFilesSection(fileEvents: StoredEvent[], maxFiles: number): string {
  if (fileEvents.length === 0) return "";

  const fileMap = new Map<string, Set<string>>();
  for (const ev of fileEvents) {
    let ops = fileMap.get(ev.data);
    if (!ops) {
      ops = new Set();
      fileMap.set(ev.data, ops);
    }
    ops.add(ev.type.replace(/^file_/, ""));
  }

  // 按出现顺序取最近 maxFiles 个。
  const entries = Array.from(fileMap.entries()).slice(-maxFiles);
  const lines: string[] = [];
  for (const [path, ops] of entries) {
    const fileName = path.split("/").pop() ?? path;
    lines.push(`    ${escapeXML(fileName)} (${Array.from(ops).join(", ")})`);
  }

  return [`  <files count="${fileMap.size}">`, ...lines, `  </files>`].join("\n");
}

function buildErrorsSection(errorEvents: StoredEvent[]): string {
  if (errorEvents.length === 0) return "";
  const lines = errorEvents.map((ev) => `    ${escapeXML(truncate(ev.data, 200))}`);
  return [`  <errors count="${errorEvents.length}">`, ...lines, `  </errors>`].join("\n");
}

function buildDecisionsSection(decisionEvents: StoredEvent[]): string {
  if (decisionEvents.length === 0) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ev of decisionEvents) {
    if (seen.has(ev.data)) continue;
    seen.add(ev.data);
    lines.push(`    ${escapeXML(truncate(ev.data, 300))}`);
  }
  if (lines.length === 0) return "";
  return [`  <decisions count="${lines.length}">`, ...lines, `  </decisions>`].join("\n");
}

function buildGitSection(gitEvents: StoredEvent[]): string {
  if (gitEvents.length === 0) return "";
  const lines = gitEvents.slice(-20).map((ev) => `    ${escapeXML(truncate(ev.data, 200))}`);
  return [`  <git count="${gitEvents.length}">`, ...lines, `  </git>`].join("\n");
}

function buildEnvironmentSection(cwdEvents: StoredEvent[]): string {
  if (cwdEvents.length === 0) return "";
  const lastCwd = cwdEvents[cwdEvents.length - 1];
  return [
    `  <environment>`,
    `    cwd: ${escapeXML(lastCwd.data)}`,
    `  </environment>`,
  ].join("\n");
}

function buildRecentMessagesSection(userPromptEvents: StoredEvent[], max: number): string {
  if (userPromptEvents.length === 0) return "";
  const recent = userPromptEvents.slice(-max);
  const items = recent
    .map((ev) => {
      const body = truncate(ev.data, 400);
      return body ? `    <message>${escapeXML(body)}</message>` : "";
    })
    .filter(Boolean);
  if (items.length === 0) return "";
  return [`  <recent_user_messages count="${items.length}">`, ...items, `  </recent_user_messages>`].join("\n");
}

export function buildResumeSnapshot(events: StoredEvent[], opts: BuildSnapshotOpts = {}): string {
  const compactCount = opts.compactCount ?? 1;
  const maxFiles = opts.maxFiles ?? 10;
  const maxRecentMessages = opts.maxRecentMessages ?? 3;
  const now = new Date().toISOString();

  const fileEvents: StoredEvent[] = [];
  const errorEvents: StoredEvent[] = [];
  const decisionEvents: StoredEvent[] = [];
  const gitEvents: StoredEvent[] = [];
  const cwdEvents: StoredEvent[] = [];
  const goalEvents: StoredEvent[] = [];
  const userPromptEvents: StoredEvent[] = [];

  for (const ev of events) {
    switch (ev.category) {
      case "file": fileEvents.push(ev); break;
      case "error": errorEvents.push(ev); break;
      case "decision": decisionEvents.push(ev); break;
      case "git": gitEvents.push(ev); break;
      case "cwd": cwdEvents.push(ev); break;
      case "goal": goalEvents.push(ev); break;
      case "user-prompt": userPromptEvents.push(ev); break;
    }
  }

  const sections: string[] = [];

  sections.push(
    `  <how_to_search>
  以下是先前工作的摘要。需要完整细节时，可用 ctx_search 工具检索本会话历史；
  不要向用户重复询问之前已经解释过的内容，先检索。
  </how_to_search>`,
  );

  const goal = buildGoalSection(goalEvents);
  if (goal) sections.push(goal);

  const files = buildFilesSection(fileEvents, maxFiles);
  if (files) sections.push(files);

  const errors = buildErrorsSection(errorEvents);
  if (errors) sections.push(errors);

  const decisions = buildDecisionsSection(decisionEvents);
  if (decisions) sections.push(decisions);

  const git = buildGitSection(gitEvents);
  if (git) sections.push(git);

  const environment = buildEnvironmentSection(cwdEvents);
  if (environment) sections.push(environment);

  const recentMessages = buildRecentMessagesSection(userPromptEvents, maxRecentMessages);
  if (recentMessages) sections.push(recentMessages);

  const header = `<session_resume events="${events.length}" compact_count="${compactCount}" generated_at="${now}">`;
  const footer = `</session_resume>`;

  const body = sections.join("\n\n");
  return body ? `${header}\n\n${body}\n\n${footer}` : `${header}\n${footer}`;
}