/**
 * 路由拦截 —— 把会污染上下文的内联 HTTP 客户端调用从 bash 中拦下。
 *
 * 移植自 context-mode（mksglu/context-mode）的 pi 适配器路由逻辑，
 * 但仅保留与当前 pi 原生工具（bash/read/write/edit/grep/find）相关的部分，
 * 不依赖 MCP 沙盒服务器。
 *
 * 策略分为两类：
 *   - BLOCKED_HTTP_PATTERNS：语言级 HTTP 调用（fetch / requests / http / urllib /
 *     Invoke-WebRequest）。这些调用几乎必然把原始响应体灌进上下文，无条件拦截。
 *   - curl / wget：由 isSafeCurlWget() 单独判断。静默 + 输出到文件的形式作为逃生
 *     通道保留（响应体不进上下文）；stdout、verbose、缺文件输出的形式仍拦截。
 *
 * 两者都先经过 stripQuotedContent()，避免引号内的命令参数（例如
 * `gh issue list --search "curl wget"`）误报。
 */

export const BLOCKED_HTTP_PATTERNS: RegExp[] = [
  /\bfetch\s*\(/,
  /\brequests\.get\s*\(/,
  /\brequests\.post\s*\(/,
  /\bhttp\.get\s*\(/,
  /\bhttp\.request\s*\(/,
  /\burllib\.request/,
  /\bInvoke-WebRequest\b/,
];

/**
 * 剥离 heredoc + 单引号 + 双引号内容，让路由正则只看到命令 token，
 * 而不是用户提供的字符串。
 */
export function stripQuotedContent(cmd: string): string {
  return cmd
    .replace(/<<-?\s*["']?(\w+)["']?[\s\S]*?\n\s*\1/g, "")
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
}

/**
 * 判断 `segment` 是否为「安全」的 curl/wget 调用，即响应体不会进入模型上下文：
 * 响应体写到磁盘（或追加到文件），且没有 verbose/trace 把请求头倒进 stderr。
 */
export function isSafeCurlWget(segment: string): boolean {
  const s = segment.trim();
  const isCurl = /\bcurl\b/i.test(s);
  const isWget = /\bwget\b/i.test(s);
  if (!isCurl && !isWget) return true; // 非 curl/wget —— 无需判断

  // 文件输出：curl 的 -o/--output，wget 的 -O/--output-document，或 shell 重定向。
  const hasFileOutput = isCurl
    ? /\s(-o|--output)\s/.test(s) || /\s>\s*/.test(s) || /\s>>\s*/.test(s)
    : /\s(-O|--output-document)\s/.test(s) ||
      /\s>\s*/.test(s) ||
      /\s>>\s*/.test(s);
  if (!hasFileOutput) return false; // 无文件输出 → 响应体流向 stdout

  // stdout 别名：-o -、-o /dev/stdout、-O -、-O /dev/stdout。
  if (isCurl && /\s(-o|--output)\s+(-|\/dev\/stdout)(\s|$)/.test(s)) return false;
  if (isWget && /\s(-O|--output-document)\s+(-|\/dev\/stdout)(\s|$)/.test(s))
    return false;

  // verbose/trace 会把请求+响应头倒进 stderr → 上下文。
  if (/\s(-v|--verbose|--trace)\b/.test(s)) return false;

  // 必须静默：curl 用 -s/--silent，wget 用 -q/--quiet。
  const isSilent = isCurl
    ? /\s-[a-zA-Z]*s|--silent/.test(s)
    : /\s-[a-zA-Z]*q|--quiet/.test(s);
  return isSilent;
}

export interface RoutingDecision {
  block: boolean;
  reason: string;
}

/**
 * 评估一条 bash 命令。返回拦截决策；不拦截时返回 null。
 */
export function evaluateCommand(command: string): RoutingDecision | null {
  if (!command) return null;

  const stripped = stripQuotedContent(command);

  // 语言级 HTTP 调用无条件拦截。
  if (BLOCKED_HTTP_PATTERNS.some((p) => p.test(stripped))) {
    return {
      block: true,
      reason:
        "不要用内联 HTTP 客户端（fetch/requests/http/urllib/Invoke-WebRequest）抓数据。" +
        "这会把原始响应体灌进上下文。请改为：curl/wget 静默下载到文件后，用 read/grep " +
        "只读取你需要的部分，或写一段脚本在本地计算并只打印结果。",
    };
  }

  // curl / wget —— 按 && || ; 拆链，逐段判断。
  if (/(^|\s|&&|\||\;)(curl|wget)\s/i.test(stripped)) {
    const segments = stripped.split(/\s*(?:&&|\|\||;)\s*/);
    const hasUnsafeSegment = segments.some((seg) => !isSafeCurlWget(seg));
    if (hasUnsafeSegment) {
      return {
        block: true,
        reason:
          "不要用会把原始响应体直接打印到 stdout 的 curl/wget。改为静默 + 文件输出：" +
          "`curl -s -o /tmp/x.json URL` 或 `wget -q -O /tmp/x.json URL`，然后再用 read/grep " +
          "只读取需要的部分。",
      };
    }
  }

  return null;
}