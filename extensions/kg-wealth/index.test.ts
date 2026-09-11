import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import kgWealth from "./index.js";

type Handler = (event: any, ctx: any) => Promise<void> | void;

type Command = {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

function installExtension(
  sessionEntries: unknown[] = [],
  sessionId = "session-1",
  options: { activeBranchEntries?: unknown[]; leafId?: string | null } = {},
) {
  const handlers = new Map<string, Handler>();
  let command: Command | undefined;
  const pi = {
    on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
    registerCommand: vi.fn((name: string, options: Command) => {
      if (name === "kg-wealth") command = options;
    }),
    sendUserMessage: vi.fn(),
  } as unknown as ExtensionAPI;
  const activeBranchEntries = options.activeBranchEntries ?? sessionEntries;
  const ctx = {
    waitForIdle: vi.fn(async () => undefined),
    hasUI: true,
    ui: { notify: vi.fn() },
    sessionManager: {
      getSessionId: vi.fn(() => sessionId),
      getLeafId: vi.fn(() => options.leafId ?? "leaf-1"),
      getEntries: vi.fn(() => sessionEntries),
      buildContextEntries: vi.fn(() => activeBranchEntries),
    },
  } as unknown as ExtensionCommandContext;

  kgWealth(pi);

  return {
    pi,
    ctx,
    command: () => {
      if (!command) throw new Error("command not registered");
      return command;
    },
    emit: async (event: string, payload: any = {}) => {
      await handlers.get(event)?.(payload, ctx);
    },
  };
}

describe("kg-wealth extension", () => {
  it("注册 /kg-wealth 命令", () => {
    const { pi } = installExtension();

    expect(pi.registerCommand).toHaveBeenCalledWith(
      "kg-wealth",
      expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }),
    );
  });

  it("活动 branch 尚无 assistant 文本时可使用运行期间缓存并关闭模板展开", async () => {
    const { pi, ctx, command, emit } = installExtension();

    await emit("message_end", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "缓存输出" }],
      },
    });
    await command().handler("", ctx);

    expect(ctx.waitForIdle).toHaveBeenCalled();
    expect(ctx.sessionManager.buildContextEntries).toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("缓存输出"),
      { expandPromptTemplates: false },
    );
  });

  it("活动 branch 已有 assistant 文本时优先使用当前可见分支而不是缓存", async () => {
    const activeBranch = [
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "当前可见输出" }] },
      },
    ];
    const { pi, ctx, command, emit } = installExtension([], "session-1", {
      activeBranchEntries: activeBranch,
      leafId: "parent-leaf",
    });

    await emit("message_end", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "不可见缓存输出" }],
      },
    });
    await command().handler("", ctx);

    expect(ctx.sessionManager.buildContextEntries).toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("当前可见输出"),
      { expandPromptTemplates: false },
    );
    expect(pi.sendUserMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("不可见缓存输出"),
      expect.anything(),
    );
  });

  it("缓存不足时从当前活动 branch entries 回退查找", async () => {
    const { pi, ctx, command } = installExtension([
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "历史输出" }] },
      },
    ]);

    await command().handler("", ctx);

    expect(ctx.sessionManager.buildContextEntries).toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("历史输出"),
      { expandPromptTemplates: false },
    );
  });

  it("session fallback 只从当前活动 branch 选择最后有效 assistant 文本", async () => {
    const currentBranch = [
      {
        id: "root-assistant",
        parentId: "root-user",
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "当前分支输出" }] },
      },
    ];
    const siblingBranchNewerInAppendOrder = {
      id: "sibling-assistant",
      parentId: "sibling-user",
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "旁支较新输出" }] },
    };
    const { pi, ctx, command } = installExtension(
      [...currentBranch, siblingBranchNewerInAppendOrder],
      "session-1",
      { activeBranchEntries: currentBranch, leafId: "root-assistant" },
    );

    await command().handler("", ctx);

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("当前分支输出"),
      { expandPromptTemplates: false },
    );
    expect(pi.sendUserMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("旁支较新输出"),
      expect.anything(),
    );
  });

  it("没有可用 assistant 文本时不提交消息并提示 warning", async () => {
    const { pi, ctx, command } = installExtension();

    await command().handler("", ctx);

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("未找到"), "warning");
  });

  it("导航回 message_end 记录的父 leaf 且活动 branch 不含缓存 assistant 时不使用缓存", async () => {
    const { pi, ctx, command, emit } = installExtension([], "session-1", {
      activeBranchEntries: [],
      leafId: "parent-leaf",
    });

    await emit("message_end", {
      message: { role: "assistant", content: [{ type: "text", text: "不可见子分支输出" }] },
    });
    await emit("session_tree", { oldLeafId: "assistant-leaf", newLeafId: "parent-leaf" });
    await command().handler("", ctx);

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("未找到"), "warning");
  });

  it("当前 leaf 变化后不再使用缓存，回退到活动 branch", async () => {
    const activeBranch = [
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "导航后分支输出" }] },
      },
    ];
    const { pi, ctx, command, emit } = installExtension([], "session-1", {
      activeBranchEntries: activeBranch,
      leafId: "leaf-before-navigation",
    });

    await emit("message_end", {
      message: { role: "assistant", content: [{ type: "text", text: "导航前缓存输出" }] },
    });
    vi.mocked(ctx.sessionManager.getLeafId).mockReturnValue("leaf-after-navigation");
    await command().handler("", ctx);

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("导航后分支输出"),
      { expandPromptTemplates: false },
    );
    expect(pi.sendUserMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("导航前缓存输出"),
      expect.anything(),
    );
  });

  it("不同 session 的缓存不会污染当前 session", async () => {
    const { pi, ctx, command, emit } = installExtension([
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "当前会话历史" }] },
      },
    ], "session-1");

    await emit("message_end", {
      message: { role: "assistant", content: [{ type: "text", text: "旧会话缓存" }] },
    });
    vi.mocked(ctx.sessionManager.getSessionId).mockReturnValue("session-2");
    await command().handler("", ctx);

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("当前会话历史"),
      { expandPromptTemplates: false },
    );
  });
});
