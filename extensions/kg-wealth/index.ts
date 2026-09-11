import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractAssistantText, findLastAssistantText } from "./extract.js";
import { buildKgWealthPrompt } from "./prompt.js";

type CachedAssistantText = {
  sessionId: string;
  text: string;
};

export default function kgWealth(pi: ExtensionAPI): void {
  let cachedAssistantText: CachedAssistantText | undefined;

  pi.on("message_end", (event, ctx) => {
    const text = extractAssistantText(event.message);
    if (!text) return;

    cachedAssistantText = {
      sessionId: ctx.sessionManager.getSessionId(),
      text,
    };
  });

  pi.on("session_tree", () => {
    cachedAssistantText = undefined;
  });

  pi.registerCommand("kg-wealth", {
    description: "将最后一次 assistant 输出沉淀到 wealth 知识库",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const sessionId = ctx.sessionManager.getSessionId();
      const branchText = findLastAssistantText(ctx.sessionManager.buildContextEntries());
      const text =
        branchText ??
        (cachedAssistantText?.sessionId === sessionId ? cachedAssistantText.text : undefined);

      if (!text) {
        ctx.ui.notify(
          "kg-wealth：未找到最近一次有效 assistant 文本输出，未提交知识沉淀任务。",
          "warning",
        );
        return;
      }

      pi.sendUserMessage(buildKgWealthPrompt(text), { expandPromptTemplates: false });
    },
  });
}
