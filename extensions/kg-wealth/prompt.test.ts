import { describe, expect, it } from "vitest";
import { KG_WEALTH_KNOWLEDGE_DIR, buildKgWealthPrompt } from "./prompt.js";

describe("buildKgWealthPrompt", () => {
  it("包含目标目录、类型集合、文件写入要求和原始 assistant 输出", () => {
    const prompt = buildKgWealthPrompt("上一条输出\n```ts\nconst x = 1;\n```");

    expect(prompt).toContain(KG_WEALTH_KNOWLEDGE_DIR);
    expect(prompt).toContain("doing-fragment | knowledge-fragment | decision-fragment | experience-fragment | research-fragment | review-fragment");
    expect(prompt).toContain("实际使用工具写入文件");
    expect(prompt).toContain("<assistant_last_output>");
    expect(prompt).toContain("上一条输出\n```ts\nconst x = 1;\n```");
    expect(prompt).toContain("</assistant_last_output>");
  });

  it("明确要求完成后只回复路径、类型和一句主题", () => {
    const prompt = buildKgWealthPrompt("决策内容");

    expect(prompt).toContain("只回复");
    expect(prompt).toContain("已创建的文件路径");
    expect(prompt).toContain("判断出的片段类型");
    expect(prompt).toContain("一句话说明整理主题");
  });
});
