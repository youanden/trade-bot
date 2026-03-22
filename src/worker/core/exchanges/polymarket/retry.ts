import { ClobApiError } from "./errors";

/**
 * Retry wrapper for idempotent operations.
 * Retries on network errors and retryable ClobApiErrors (429, 5xx).
 * Does NOT retry on non-retryable ClobApiErrors (400, 401, 403, 404).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts - 1;
      if (isLast) throw err;
      if (err instanceof ClobApiError && !err.isRetryable) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("withRetry: unreachable");
}
