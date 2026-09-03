import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RM_COMMAND_PATTERN = /(^|[;&|()\s])rm(\s|$)/;

export default function (pi: ExtensionAPI) {
  // rm 工具操作门禁：命中后等待用户确认；拒绝后终止本轮行动，并等待用户输入下一步指令。
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command ?? "";
    if (!RM_COMMAND_PATTERN.test(command)) return;

    if (ctx.hasUI) {
      const ok = await ctx.ui.confirm(
        "Confirm rm operation",
        `检测到 rm 操作，是否允许执行？\n\n${command}`,
      );

      if (ok) return;

      await ctx.ui.input(
        "Blocked rm operation",
        "已拒绝 rm 操作并终止本轮行动。请输入下一步指令。",
      );
    }

    return {
      block: true,
      terminate: true,
      reason: "Blocked rm operation by user. Waiting for user input before continuing.",
    };
  });
}
