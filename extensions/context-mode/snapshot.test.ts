import { describe, it, expect } from "vitest";
import { buildResumeSnapshot } from "./snapshot.js";
import type { StoredEvent } from "./db.js";

function ev(partial: Partial<StoredEvent> & { type: string; category: string; data: string }): StoredEvent {
  let id = 0;
  return {
    id: ++id,
    priority: 1,
    data_hash: "",
    created_at: "2026-09-07 10:00:00",
    ...partial,
  };
}

describe("buildResumeSnapshot", () => {
  it("空事件只输出头部与尾部", () => {
    const snap = buildResumeSnapshot([]);
    expect(snap).toContain("<session_resume");
    expect(snap).toContain("</session_resume>");
    expect(snap).not.toContain("<files ");
  });

  it("包含目标小节", () => {
    const snap = buildResumeSnapshot([
      ev({ type: "goal", category: "goal", data: "重构订单", priority: 4 }),
    ]);
    expect(snap).toContain("<session_goal>");
    expect(snap).toContain("重构订单");
  });

  it("包含文件与 git 小节", () => {
    const snap = buildResumeSnapshot([
      ev({ type: "file_write", category: "file", data: "a.ts" }),
      ev({ type: "git_commit", category: "git", data: "fix bug" }),
    ]);
    expect(snap).toContain("<files count=");
    expect(snap).toContain("<git count=");
  });

  it("包含最近用户消息", () => {
    const snap = buildResumeSnapshot([
      ev({ type: "user_prompt", category: "user-prompt", data: "帮我修 bug", priority: 2 }),
    ]);
    expect(snap).toContain("<recent_user_messages");
    expect(snap).toContain("帮我修 bug");
  });

  it("XML 特殊字符被转义", () => {
    const snap = buildResumeSnapshot([
      ev({ type: "goal", category: "goal", data: "a < b & c > d", priority: 4 }),
    ]);
    expect(snap).toContain("a &lt; b &amp; c &gt; d");
  });
});