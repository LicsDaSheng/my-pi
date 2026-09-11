/**
 * dev-plan 扩展 —— 开发方案编排命令。
 *
 * 将 prompts/dev-plan.md 的提示词式命令重构为 pi extension command。
 * 扩展负责参数校验和提示词注入；编排智能仍由 LLM 驱动。
 *
 * 命令：
 *   /dev-plan <需求>  — 启动开发方案工作流（探索→访谈→设计→评审→交付）
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildDevPlanPrompt } from "./prompt.js";

export default function devPlan(pi: ExtensionAPI): void {
  pi.registerCommand("dev-plan", {
    description: "主会话编排探索、用户访谈、开发方案与最多三次独立评审；不编码",
    handler: async (args, ctx) => {
      const requirement = args.trim();

      if (!requirement) {
        ctx.ui.notify("dev-plan：请提供原始需求描述。示例：/dev-plan 为订单导出增加日期范围筛选", "warning");
        return;
      }

      const prompt = buildDevPlanPrompt(requirement);
      pi.sendUserMessage(prompt);
    },
  });
}