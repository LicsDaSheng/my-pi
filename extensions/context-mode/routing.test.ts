import { describe, it, expect } from "vitest";
import {
  evaluateCommand,
  isSafeCurlWget,
  stripQuotedContent,
} from "./routing.js";

describe("stripQuotedContent", () => {
  it("剥掉双引号内容", () => {
    expect(stripQuotedContent(`echo "curl wget"`)).toBe(`echo ""`);
  });

  it("剥掉单引号内容", () => {
    expect(stripQuotedContent("echo 'curl wget'")).toBe("echo ''");
  });

  it("剥掉 heredoc", () => {
    const cmd = `cat <<'EOF'\ncurl wget\nEOF\n`;
    expect(stripQuotedContent(cmd)).not.toContain("curl");
  });
});

describe("isSafeCurlWget", () => {
  it("非 curl/wget 段视为安全", () => {
    expect(isSafeCurlWget("mkdir -p /tmp/x")).toBe(true);
  });

  it("curl 静默 + 文件输出是安全的", () => {
    expect(isSafeCurlWget("curl -s -o /tmp/x.json https://example.com")).toBe(true);
  });

  it("curl 输出到 stdout 不安全", () => {
    expect(isSafeCurlWget("curl https://example.com")).toBe(false);
  });

  it("wget 静默 + 文件输出是安全的", () => {
    expect(isSafeCurlWget("wget -q -O /tmp/x.json https://example.com")).toBe(true);
  });

  it("wget 无文件输出不安全", () => {
    expect(isSafeCurlWget("wget https://example.com")).toBe(false);
  });

  it("verbose 标志不安全", () => {
    expect(isSafeCurlWget("curl -sv https://example.com")).toBe(false);
  });

  it("stdout 别名 -o - 不安全", () => {
    expect(isSafeCurlWget("curl -s -o - https://example.com")).toBe(false);
  });
});

describe("evaluateCommand", () => {
  it("拦截 unquoted fetch", () => {
    expect(evaluateCommand(`fetch('http://x')`)?.block).toBe(true);
  });

  it("拦截 stdout 输出的 curl", () => {
    expect(evaluateCommand("curl https://example.com")?.block).toBe(true);
  });

  it("放行静默 + 文件输出的 curl", () => {
    expect(evaluateCommand("curl -s -o /tmp/x.json https://example.com")?.block).not.toBe(true);
  });

  it("放行静默 + 文件输出的 wget", () => {
    expect(evaluateCommand("wget -q -O /tmp/x.json https://example.com")?.block).not.toBe(true);
  });

  it("拦截链式命令中的不安全 curl 段", () => {
    expect(evaluateCommand("git status && curl https://example.com")?.block).toBe(true);
  });

  it("放行普通 bash 命令", () => {
    expect(evaluateCommand("mkdir -p /tmp/foo")).toBeNull();
  });

  it("空命令返回 null", () => {
    expect(evaluateCommand("")).toBeNull();
  });
});