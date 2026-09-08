/**
 * 会话事件抽取 —— 从 pi 的工具调用与用户输入中抽取结构化事件。
 *
 * 移植自 context-mode 的 session/extract.ts 思路，但裁剪为与当前 pi
 * 原生工具匹配的子集：文件读写编辑检索、git 操作、cwd、错误、用户目标/决策。
 * 不依赖平台无关的 MCP 工具名。
 */

import type { SessionEvent } from "./db.js";
import { dataHash } from "./db.js";

/** pi 工具名 → 抽取器内部统一约定（保持与源项目 PascalCase 约定一致）。 */
const PI_TOOL_MAP: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  find: "Find",
  ls: "Ls",
};

function makeEvent(
  type: string,
  category: string,
  data: string,
  priority: number,
): SessionEvent {
  return { type, category, data, priority, data_hash: dataHash(data) };
}

function safeString(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

const GIT_PATTERNS: Array<{ pattern: RegExp; operation: string }> = [
  { pattern: /\bgit\s+checkout\b/, operation: "branch" },
  { pattern: /\bgit\s+commit\b/, operation: "commit" },
  { pattern: /\bgit\s+merge\s+\S+/, operation: "merge" },
  { pattern: /\bgit\s+rebase\b/, operation: "rebase" },
  { pattern: /\bgit\s+stash\b/, operation: "stash" },
  { pattern: /\bgit\s+push\b/, operation: "push" },
  { pattern: /\bgit\s+pull\b/, operation: "pull" },
  { pattern: /\bgit\s+log\b/, operation: "log" },
  { pattern: /\bgit\s+diff\b/, operation: "diff" },
  { pattern: /\bgit\s+status\b/, operation: "status" },
  { pattern: /\bgit\s+branch\b/, operation: "branch" },
  { pattern: /\bgit\s+reset\b/, operation: "reset" },
  { pattern: /\bgit\s+add\b/, operation: "add" },
  { pattern: /\bgit\s+cherry-pick\b/, operation: "cherry-pick" },
  { pattern: /\bgit\s+tag\b/, operation: "tag" },
  { pattern: /\bgit\s+fetch\b/, operation: "fetch" },
  { pattern: /\bgit\s+clone\b/, operation: "clone" },
  { pattern: /\bgit\s+worktree\b/, operation: "worktree" },
];

/** 从 git commit 命令中提取 -m / -am / --message= 的提交信息。 */
function extractCommitMessage(command: string): string {
  // --message="..." / --message='...' / --message=word
  const long = command.match(/--message=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/);
  if (long) return (long[1] ?? long[2] ?? long[3] ?? "").trim();

  // -m "..." / -am "..." / -m'...'
  const quoted = command.match(/(?:^|\s)-a?m\s+(?:"([^"]*)"|'([^']*)')/);
  if (quoted) return (quoted[1] ?? quoted[2] ?? "").trim();

  // -m word（未加引号的单词）
  const bare = command.match(/(?:^|\s)-a?m\s+(\S+)/);
  if (bare) return bare[1];

  return "";
}

function extractGit(command: string): SessionEvent[] {
  if (!/\bgit\b/.test(command)) return [];

  const match = GIT_PATTERNS.find((p) => p.pattern.test(command));
  if (!match) return [];

  if (match.operation === "commit") {
    const msg = extractCommitMessage(command);
    if (msg) {
      return [makeEvent("git_commit", "git", msg, 2)];
    }
  }

  return [makeEvent("git", "git", match.operation, 2)];
}

function extractCwd(command: string): SessionEvent[] {
  const cdMatch = command.match(/\bcd\s+("([^"]+)"|'([^']+)'|(\S+))/);
  if (!cdMatch) return [];
  const dir = cdMatch[2] ?? cdMatch[3] ?? cdMatch[4] ?? "";
  if (!dir) return [];
  return [makeEvent("cwd", "cwd", dir, 2)];
}

function looksLikeError(toolName: string, isError: boolean, result: string): boolean {
  if (isError) return true;
  if (toolName === "Bash") {
    return /exit code [1-9]|error:|Error:|FAIL|failed/i.test(result);
  }
  return false;
}

/** 抽取单次工具调用（已执行完毕）产生的事件。 */
export function extractToolEvents(input: {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}): SessionEvent[] {
  const { params, result, isError } = input;
  const toolName = PI_TOOL_MAP[input.toolName.toLowerCase()] ?? input.toolName;
  const events: SessionEvent[] = [];
  const err = looksLikeError(toolName, !!isError, safeString(result));

  switch (toolName) {
    case "Read": {
      const filePath = safeString(params.path ?? params.file_path);
      if (filePath) {
        const isRule = /(^|\/)(AGENTS\.md|CLAUDE\.md|README(\.md)?)$/i.test(filePath);
        if (isRule) events.push(makeEvent("rule", "rule", filePath, 1));
        else events.push(makeEvent("file_read", "file", filePath, 1));
      }
      break;
    }
    case "Write": {
      const filePath = safeString(params.path ?? params.file_path);
      if (filePath) events.push(makeEvent("file_write", "file", filePath, 1));
      break;
    }
    case "Edit": {
      const filePath = safeString(params.path ?? params.file_path);
      if (filePath) events.push(makeEvent("file_edit", "file", filePath, 1));
      break;
    }
    case "Grep": {
      const pattern = safeString(params.pattern);
      const filePath = safeString(params.path);
      if (pattern) {
        events.push(
          makeEvent("file_search", "file", filePath ? `${pattern} in ${filePath}` : pattern, 3),
        );
      }
      break;
    }
    case "Find": {
      const pattern = safeString(params.pattern);
      const filePath = safeString(params.path);
      if (pattern) {
        events.push(
          makeEvent("file_glob", "file", filePath ? `${pattern} in ${filePath}` : pattern, 3),
        );
      }
      break;
    }
    case "Bash": {
      const command = safeString(params.command);
      if (command) {
        events.push(...extractCwd(command));
        events.push(...extractGit(command));
      }
      break;
    }
  }

  if (err) {
    events.push(
      makeEvent(
        "error_tool",
        "error",
        safeString(result).slice(0, 500) || toolName,
        2,
      ),
    );
  }

  return events;
}

/**
 * 从用户提示词中抽取轻量结构化事件。
 *
 * 源项目在此做了 plan/decision/role/intent/goal/blocker/data 等多类检测。
 * 自包含版本只抽取最影响连续性恢复的几类：目标（goal）与决策（decision），
 * 并且始终记录一条 user-prompt 事件作为最近消息的安全网。
 */
export function extractUserEvents(message: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const text = message.trim();
  if (!text) return events;

  events.push(makeEvent("user_prompt", "user-prompt", text.slice(0, 800), 2));

  // goal：明确的「目标 / goal / 我要 / 我们的目标是」等强信号。
  const goalMatch = text.match(
    /\b(?:目标|goal|objective)\s*[:：]\s*(.+)|(?:我的目标是|我们的目标是|目标是)\s*(.+)/i,
  );
  if (goalMatch) {
    const goal = (goalMatch[1] ?? goalMatch[2] ?? "").trim();
    if (goal) events.push(makeEvent("goal", "goal", goal.slice(0, 500), 4));
  }

  // decision：明确的「决定 / 采用 / 就用 / 选择」等强信号。
  const decisionMatch = text.match(
    /\b(?:决定|采用|使用方案|choose|decision)\s*[:：]\s*(.+)|(?:我决定|我们就用|决定了)\s*(.+)/i,
  );
  if (decisionMatch) {
    const decision = (decisionMatch[1] ?? decisionMatch[2] ?? "").trim();
    if (decision) events.push(makeEvent("decision", "decision", decision.slice(0, 500), 3));
  }

  return events;
}