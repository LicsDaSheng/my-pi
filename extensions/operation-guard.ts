import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RM_COMMAND_PATTERN = /(^|[;&|()\s])rm(\s|$)/;

export default function (pi: ExtensionAPI) {
  // rm 工具操作门禁：命中后直接终止本轮行动，并等待用户输入下一步指令。
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command ?? "";
    if (!RM_COMMAND_PATTERN.test(command)) return;

    if (ctx.hasUI) {
      await ctx.ui.input(
        "Blocked rm operation",
        `检测到 rm 操作，已终止本轮行动。请确认后输入下一步指令。\n\n${command}`,
      );
    }

    return {
      block: true,
      terminate: true,
      reason: "Blocked rm operation. Waiting for user input before continuing.",
    };
  });
}
