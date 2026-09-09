export const RETRY_DELAY_MS = 3_000;
export const RATE_LIMIT_PATTERN = /\b429\b|too many requests|rate[\s-]?limit/i;
export const NON_RETRYABLE_429_PATTERN =
  /insufficient[\s_-]*quota|billing|quota\s*(?:exceeded|exhausted|limit)|usage\s*limit|credit\s*(?:balance|exhausted|depleted)|payment required/i;

export interface AssistantErrorMessage {
  role: string;
  stopReason?: string;
  errorMessage?: string;
}

export function isRetryableRateLimitError(message: AssistantErrorMessage): boolean {
  if (message.role !== "assistant" || message.stopReason !== "error" || !message.errorMessage) {
    return false;
  }

  return (
    RATE_LIMIT_PATTERN.test(message.errorMessage) &&
    !NON_RETRYABLE_429_PATTERN.test(message.errorMessage)
  );
}