import { describe, it, expect } from "vitest";
import { extractToolEvents, extractUserEvents } from "./extract.js";

describe("extractToolEvents - 文件操作", () => {
  it("read → file_read", () => {
    const events = extractToolEvents({ toolName: "read", params: { path: "src/a.ts" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "file_read", category: "file", data: "src/a.ts" }));
  });

  it("read AGENTS.md → rule", () => {
    const events = extractToolEvents({ toolName: "read", params: { path: "AGENTS.md" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "rule", category: "rule" }));
  });

  it("write → file_write", () => {
    const events = extractToolEvents({ toolName: "write", params: { path: "x.ts", content: "a" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "file_write", category: "file", data: "x.ts" }));
  });

  it("edit → file_edit", () => {
    const events = extractToolEvents({ toolName: "edit", params: { path: "x.ts" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "file_edit", category: "file" }));
  });

  it("grep → file_search", () => {
    const events = extractToolEvents({ toolName: "grep", params: { pattern: "TODO", path: "src" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "file_search", category: "file" }));
  });

  it("find → file_glob", () => {
    const events = extractToolEvents({ toolName: "find", params: { pattern: "*.ts" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "file_glob", category: "file" }));
  });
});

describe("extractToolEvents - git", () => {
  it("git commit -m 提取提交信息", () => {
    const events = extractToolEvents({ toolName: "bash", params: { command: `git commit -m "fix bug"` } });
    expect(events).toContainEqual(expect.objectContaining({ type: "git_commit", category: "git", data: "fix bug" }));
  });

  it("git commit -am 提取提交信息", () => {
    const events = extractToolEvents({ toolName: "bash", params: { command: `git commit -am "fix bug"` } });
    expect(events).toContainEqual(expect.objectContaining({ type: "git_commit", data: "fix bug" }));
  });

  it("git commit --message= 提取提交信息", () => {
    const events = extractToolEvents({ toolName: "bash", params: { command: `git commit --message="fix bug 2"` } });
    expect(events).toContainEqual(expect.objectContaining({ type: "git_commit", data: "fix bug 2" }));
  });

  it("git add 归类为 git/add", () => {
    const events = extractToolEvents({ toolName: "bash", params: { command: "git add ." } });
    expect(events).toContainEqual(expect.objectContaining({ type: "git", category: "git", data: "add" }));
  });

  it("非 git 命令不产生 git 事件", () => {
    const events = extractToolEvents({ toolName: "bash", params: { command: "ls -la" } });
    expect(events.filter((e) => e.category === "git")).toHaveLength(0);
  });
});

describe("extractToolEvents - 其它", () => {
  it("cd 产生 cwd 事件", () => {
    const events = extractToolEvents({ toolName: "bash", params: { command: "cd /tmp/foo" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "cwd", category: "cwd", data: "/tmp/foo" }));
  });

  it("isError 产生 error_tool 事件", () => {
    const events = extractToolEvents({
      toolName: "bash",
      params: { command: "npm test" },
      result: "failed",
      isError: true,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "error_tool", category: "error" }));
  });

  it("bash 输出含 FAIL 识别为错误", () => {
    const events = extractToolEvents({ toolName: "bash", params: { command: "npm test" }, result: "FAILED" });
    expect(events).toContainEqual(expect.objectContaining({ type: "error_tool" }));
  });
});

describe("extractUserEvents", () => {
  it("捕获目标", () => {
    const events = extractUserEvents("我的目标是：重构订单模块");
    expect(events).toContainEqual(expect.objectContaining({ type: "goal", category: "goal", priority: 4 }));
  });

  it("捕获决策", () => {
    const events = extractUserEvents("我决定：使用方案 B");
    expect(events).toContainEqual(expect.objectContaining({ type: "decision", category: "decision" }));
  });

  it("总是记录 user-prompt 事件", () => {
    const events = extractUserEvents("hello");
    expect(events).toContainEqual(expect.objectContaining({ type: "user_prompt", category: "user-prompt", priority: 2 }));
  });

  it("空输入不产生事件", () => {
    expect(extractUserEvents("   ")).toHaveLength(0);
  });
});