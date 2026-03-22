/** Structured error class for Polymarket CLOB API HTTP errors. */

export class ClobApiError extends Error {
  readonly status: number;
  readonly context: string;
  readonly body: string;

  constructor(status: number, context: string, body: string) {
    super(`${context} ${status}: ${body}`);
    this.name = "ClobApiError";
    this.status = status;
    this.context = context;
    this.body = body;
  }

  /** Returns true for 429 (rate limit) and 5xx (server errors) — safe to retry. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** Returns true for 401 (unauthorized) and 403 (forbidden) — auth failures. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
