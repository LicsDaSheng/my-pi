export const KG_WEALTH_KNOWLEDGE_DIR = "~/Documents/wealth/knowledge";

const FRAGMENT_TYPES =
  "doing-fragment | knowledge-fragment | decision-fragment | experience-fragment | research-fragment | review-fragment";

/** 构造 /kg-wealth 固定提示词，把上一条 assistant 输出沉淀为 wealth 知识库笔记。 */
export function buildKgWealthPrompt(lastAssistantOutput: string): string {
  return `你现在要把上一条 assistant 输出整理成一个可以长期保存的“知识沉淀片段”。

目标：
- 将输入内容重新整理为结构清晰、可复用、可检索的知识库 Markdown 笔记。
- 这不是聊天总结，而是面向后续行动、复盘、决策、学习和经验复用的长期记录。
- 整理结果需要写入本地目录：\`${KG_WEALTH_KNOWLEDGE_DIR}\`。
- 你必须实际使用工具写入文件，不要只在回复中展示 Markdown 内容。

## 1. 先判断片段类型

请先根据原始内容判断它最适合归类为哪一种：

\`${FRAGMENT_TYPES}\`

类型含义：
- \`doing-fragment\`：任务推进、执行步骤、方案设计、工作流、操作清单。
- \`knowledge-fragment\`：概念解释、技术原理、方法论、工具用法、学习笔记。
- \`decision-fragment\`：判断、取舍、决策依据、结论、策略选择。
- \`experience-fragment\`：操作经验、踩坑记录、排障过程、经验教训。
- \`research-fragment\`：调研结果、资料整理、事实证据、来源限制。
- \`review-fragment\`：复盘、回顾、问题分析、改进建议。

如果内容同时包含多种类型，请选择最主要的一种，并在 tags 中补充其它相关标签。

## 2. 输出位置和文件名

请在以下目录下创建一个 Markdown 文件：

\`${KG_WEALTH_KNOWLEDGE_DIR}\`

要求：
- 如果目录不存在，请先创建目录。
- 文件名规则：\`YYYY-MM-DD-HHmm-简短主题.md\`。
- 使用当前日期时间。
- 简短主题应来自内容本身。
- 文件名不要使用空格。
- 文件名避免特殊字符。
- 如果无法准确判断主题，使用 \`知识沉淀片段\` 作为主题。

## 3. 文件 frontmatter

Markdown 文件必须至少包含以下 frontmatter：

\`\`\`markdown
---
type: 上面判断出的片段类型
created: YYYY-MM-DD HH:mm
source: pi-assistant-last-output
tags:
  - knowledge
  - 片段类型
  - 1-5个内容相关标签
---
\`\`\`

要求：
- tags 必须包含 \`knowledge\` 和判断出的片段类型。
- 根据内容补充 1-5 个额外 tags，例如 \`decision\`、\`workflow\`、\`troubleshooting\`、\`agent\`、\`pi\`。

## 4. 内容结构

请根据内容类型选择合适结构，不要机械套用所有栏目。基础结构应包含：

\`\`\`markdown
# 标题

## 背景

这段内容产生的上下文、问题来源、任务目标或讨论背景。

## 核心内容

提炼上一条 assistant 输出中真正有长期保存价值的信息。

## 关键要点

- 重要知识点
- 可复用方法
- 判断依据
- 操作步骤
- 风险提醒
- 经验教训

## 结论 / 决策 / 启发

如果原内容包含明确结论、决策、判断或启发，请整理在这里。
如果没有，请写“无明确结论”。

## 后续可用场景

说明这条知识以后适合在什么场景下被检索、复用或参考。

## 原始输出摘录

保留必要的原始内容摘录，避免过度压缩导致信息丢失。
\`\`\`

按类型可以增补这些栏目：
- 操作流程明显时，增加 \`## 操作步骤\`。
- 决策判断明显时，增加 \`## 选项对比\` 和 \`## 决策理由\`。
- 排障经验明显时，增加 \`## 问题现象\`、\`## 原因分析\`、\`## 解决方法\`、\`## 预防措施\`。
- 调研内容明显时，增加 \`## 信息来源\`、\`## 证据强度\`、\`## 不确定性\`。

## 5. 整理原则

- 不要简单复制原文。
- 不要写成聊天回复。
- 不要虚构原文没有的信息。
- 不要强行把所有内容都归类为“做事片段”。
- 应根据内容自动选择最合适的知识类型和结构。
- 如果原始输出中有命令、路径、配置、代码、结论或决策，应完整保留关键细节。
- 如果原始输出很短，也要整理成可长期保存的完整片段。
- 如果信息不足，请明确写出“不确定”或“原文未说明”。
- 必须实际使用工具写入文件；不要在最终回答里只展示 Markdown。

## 6. 完成后的回复

写入文件后，只回复：

- 已创建的文件路径
- 判断出的片段类型
- 一句话说明整理主题

不要重复输出完整文件内容。

以下是上一条 assistant 的原始输出：

<assistant_last_output>
${lastAssistantOutput}
</assistant_last_output>`;
}
