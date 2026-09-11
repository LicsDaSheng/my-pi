import { describe, expect, it } from "vitest";
import { extractAssistantText, findLastAssistantText } from "./extract.js";

const assistantMessage = (content: unknown[]) => ({
  role: "assistant",
  content,
});

describe("kg-wealth extractAssistantText", () => {
  it("只合并 assistant 文本块并保留顺序", () => {
    const text = extractAssistantText(
      assistantMessage([
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段" },
      ]),
    );

    expect(text).toBe("第一段\n\n第二段");
  });

  it("忽略 thinking、toolCall 和空白文本块", () => {
    const text = extractAssistantText(
      assistantMessage([
        { type: "thinking", thinking: "内部思考" },
        { type: "text", text: "  " },
        { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
        { type: "text", text: "可保存文本" },
      ]),
    );

    expect(text).toBe("可保存文本");
  });

  it("非 assistant 消息或无有效文本时返回 undefined", () => {
    expect(extractAssistantText({ role: "user", content: "hello" })).toBeUndefined();
    expect(extractAssistantText(assistantMessage([{ type: "thinking", thinking: "x" }]))).toBeUndefined();
  });
});

describe("kg-wealth findLastAssistantText", () => {
  it("从 session entries 倒序查找最后一条有效 assistant 文本", () => {
    const entries = [
      {
        type: "message",
        message: assistantMessage([{ type: "text", text: "旧输出" }]),
      },
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "无文本" }] },
      },
      {
        type: "message",
        message: assistantMessage([{ type: "text", text: "最新输出" }]),
      },
    ];

    expect(findLastAssistantText(entries)).toBe("最新输出");
  });

  it("跳过非 message entry 和无效 assistant entry", () => {
    const entries = [
      { type: "custom", customType: "x" },
      { type: "message", message: { role: "user", content: "不是 assistant" } },
      { type: "message", message: assistantMessage([{ type: "text", text: "  " }]) },
    ];

    expect(findLastAssistantText(entries)).toBeUndefined();
  });
});
