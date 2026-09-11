type TextBlock = {
  type: "text";
  text: string;
};

type AssistantMessageLike = {
  role?: unknown;
  content?: unknown;
};

type SessionMessageEntryLike = {
  type?: unknown;
  message?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextBlock(value: unknown): value is TextBlock {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

/** 从 assistant 消息中提取可沉淀的最终文本；忽略 thinking / toolCall / 空白文本。 */
export function extractAssistantText(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const candidate = message as AssistantMessageLike;
  if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return undefined;

  const parts = candidate.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .filter((text) => text.trim().length > 0);

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** 从当前 session entries 倒序查找最近一条有效 assistant 文本输出。 */
export function findLastAssistantText(entries: readonly unknown[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as SessionMessageEntryLike;
    if (!isRecord(entry) || entry.type !== "message") continue;

    const text = extractAssistantText(entry.message);
    if (text) return text;
  }

  return undefined;
}
