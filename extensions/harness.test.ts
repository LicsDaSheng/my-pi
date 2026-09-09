import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import harness from "./harness.js";

type Handler = (event: any, ctx: any) => Promise<void> | void;

function installHarness() {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
    sendUserMessage: vi.fn(),
  } as unknown as ExtensionAPI;
  const ctx = {
    isIdle: vi.fn(() => true),
    ui: { notify: vi.fn() },
  };

  harness(pi);

  return {
    ctx,
    pi,
    emit: async (event: string, payload: any = {}) => {
      await handlers.get(event)?.(payload, ctx);
    },
  };
}

const userMessage = (content: string) => ({ role: "user", content });
const assistantError = (errorMessage: string) => ({
  role: "assistant",
  stopReason: "error",
  errorMessage,
});

afterEach(() => vi.useRealTimers());

describe("429 retry harness", () => {
  it("warns and resends the original user message after a final 429", async () => {
    vi.useFakeTimers();
    const { ctx, pi, emit } = installHarness();

    await emit("message_start", { message: userMessage("retry this") });
    await emit("turn_end", { message: assistantError("HTTP 429: Too Many Requests") });
    const settled = emit("agent_settled");

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("3 秒"), "warning");
    await vi.advanceTimersByTimeAsync(3_000);
    await settled;

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(pi.sendUserMessage).toHaveBeenCalledWith("retry this");
  });

  it("does not retry non-429 errors", async () => {
    const { ctx, pi, emit } = installHarness();

    await emit("message_start", { message: userMessage("do not retry") });
    await emit("turn_end", { message: assistantError("HTTP 500: server error") });
    await emit("agent_settled");

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("clears a 429 candidate when a later core retry succeeds", async () => {
    const { ctx, pi, emit } = installHarness();

    await emit("message_start", { message: userMessage("core retries first") });
    await emit("turn_end", { message: assistantError("HTTP 429: rate limit") });
    await emit("turn_end", { message: { role: "assistant", stopReason: "stop" } });
    await emit("agent_settled");

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("does not retry quota or billing 429 errors", async () => {
    const { ctx, pi, emit } = installHarness();

    await emit("message_start", { message: userMessage("do not retry") });
    await emit("turn_end", {
      message: assistantError("HTTP 429: insufficient_quota; check billing"),
    });
    await emit("agent_settled");

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("retries each original user message at most once", async () => {
    vi.useFakeTimers();
    const { pi, emit } = installHarness();

    await emit("message_start", { message: userMessage("retry once") });
    await emit("turn_end", { message: assistantError("rate limit exceeded") });
    const firstSettled = emit("agent_settled");
    await vi.advanceTimersByTimeAsync(3_000);
    await firstSettled;

    // This is the message_start event emitted by the extension's resend.
    await emit("message_start", { message: userMessage("retry once") });
    await emit("turn_end", { message: assistantError("HTTP 429: too many requests") });
    await emit("agent_settled");

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
  });
});
