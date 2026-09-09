import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-ai";
import { isRetryableRateLimitError, RETRY_DELAY_MS } from "./retry.js";

export default function (pi: ExtensionAPI) {
  let savedContent: UserMessage["content"] | undefined;
  let hasRateLimitCandidate = false;
  let retryUsedForSavedMessage = false;
  let retryInFlight = false;
  let awaitingRetriedMessageStart = false;

  pi.on("message_start", (event) => {
    if (event.message.role !== "user") return;

    if (awaitingRetriedMessageStart) {
      awaitingRetriedMessageStart = false;
      return;
    }

    savedContent = event.message.content;
    hasRateLimitCandidate = false;
    retryUsedForSavedMessage = false;
  });

  pi.on("turn_end", (event) => {
    if (event.message.role !== "assistant") return;

    hasRateLimitCandidate =
      !retryUsedForSavedMessage && isRetryableRateLimitError(event.message);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (
      !hasRateLimitCandidate ||
      savedContent === undefined ||
      retryUsedForSavedMessage ||
      retryInFlight ||
      !ctx.isIdle()
    ) {
      return;
    }

    retryInFlight = true;
    retryUsedForSavedMessage = true;
    hasRateLimitCandidate = false;
    ctx.ui.notify("模型服务限流（HTTP 429），将在 3 秒后重试上一条消息。", "warning");

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      if (!ctx.isIdle()) return;

      awaitingRetriedMessageStart = true;
      pi.sendUserMessage(savedContent);
    } finally {
      retryInFlight = false;
    }
  });
}