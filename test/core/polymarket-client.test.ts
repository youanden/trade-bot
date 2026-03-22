import { describe, it, expect } from "bun:test";
import { buildHmacSignature } from "../../src/worker/core/exchanges/polymarket/hmac";
import { ClobApiError } from "../../src/worker/core/exchanges/polymarket/errors";

describe("buildHmacSignature", () => {
  it("produces URL-safe base64 output (no + or / characters)", async () => {
    // Run many times to maximize chance of hitting + or / in output
    for (let i = 0; i < 20; i++) {
      const sig = await buildHmacSignature({
        secret: "dGVzdC1zZWNyZXQ=", // base64("test-secret")
        timestamp: String(1700000000 + i),
        method: "GET",
        path: "/markets",
        body: "",
      });
      expect(sig).not.toContain("+");
      expect(sig).not.toContain("/");
      expect(sig.length).toBeGreaterThan(0);
    }
  });

  it("produces a deterministic non-empty string with known inputs", async () => {
    const sig = await buildHmacSignature({
      secret: "dGVzdC1zZWNyZXQ=", // base64("test-secret")
      timestamp: "1700000000",
      method: "GET",
      path: "/markets",
      body: "",
    });
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
  });

  it("produces the same output for the same inputs (deterministic)", async () => {
    const params = {
      secret: "dGVzdC1zZWNyZXQ=",
      timestamp: "1700000000",
      method: "GET",
      path: "/markets",
      body: "",
    };
    const sig1 = await buildHmacSignature(params);
    const sig2 = await buildHmacSignature(params);
    expect(sig1).toBe(sig2);
  });

  it("produces different output for different timestamps", async () => {
    const base = {
      secret: "dGVzdC1zZWNyZXQ=",
      method: "GET",
      path: "/markets",
      body: "",
    };
    const sig1 = await buildHmacSignature({ ...base, timestamp: "1700000000" });
    const sig2 = await buildHmacSignature({ ...base, timestamp: "1700000001" });
    expect(sig1).not.toBe(sig2);
  });
});

describe("ClobApiError", () => {
  it("stores status, context, and body fields correctly", () => {
    const err = new ClobApiError(404, "CLOB GET /markets", "not found");
    expect(err.status).toBe(404);
    expect(err.context).toBe("CLOB GET /markets");
    expect(err.body).toBe("not found");
    expect(err.name).toBe("ClobApiError");
    expect(err.message).toBe("CLOB GET /markets 404: not found");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ClobApiError).toBe(true);
  });

  it("isRetryable returns true for status 429", () => {
    const err = new ClobApiError(429, "CLOB GET /markets", "too many requests");
    expect(err.isRetryable).toBe(true);
  });

  it("isRetryable returns true for status 500", () => {
    const err = new ClobApiError(500, "CLOB GET /markets", "internal server error");
    expect(err.isRetryable).toBe(true);
  });

  it("isRetryable returns true for status 502", () => {
    const err = new ClobApiError(502, "CLOB GET /markets", "bad gateway");
    expect(err.isRetryable).toBe(true);
  });

  it("isRetryable returns true for status 503", () => {
    const err = new ClobApiError(503, "CLOB GET /markets", "service unavailable");
    expect(err.isRetryable).toBe(true);
  });

  it("isRetryable returns false for status 400", () => {
    const err = new ClobApiError(400, "CLOB POST /order", "bad request");
    expect(err.isRetryable).toBe(false);
  });

  it("isRetryable returns false for status 401", () => {
    const err = new ClobApiError(401, "CLOB GET /balance", "unauthorized");
    expect(err.isRetryable).toBe(false);
  });

  it("isRetryable returns false for status 403", () => {
    const err = new ClobApiError(403, "CLOB GET /balance", "forbidden");
    expect(err.isRetryable).toBe(false);
  });

  it("isRetryable returns false for status 404", () => {
    const err = new ClobApiError(404, "CLOB GET /markets/abc", "not found");
    expect(err.isRetryable).toBe(false);
  });

  it("isAuthError returns true for status 401", () => {
    const err = new ClobApiError(401, "CLOB GET /balance", "unauthorized");
    expect(err.isAuthError).toBe(true);
  });

  it("isAuthError returns true for status 403", () => {
    const err = new ClobApiError(403, "CLOB GET /balance", "forbidden");
    expect(err.isAuthError).toBe(true);
  });

  it("isAuthError returns false for status 400", () => {
    const err = new ClobApiError(400, "CLOB POST /order", "bad request");
    expect(err.isAuthError).toBe(false);
  });

  it("isAuthError returns false for status 429", () => {
    const err = new ClobApiError(429, "CLOB GET /markets", "too many requests");
    expect(err.isAuthError).toBe(false);
  });

  it("isAuthError returns false for status 500", () => {
    const err = new ClobApiError(500, "CLOB GET /markets", "server error");
    expect(err.isAuthError).toBe(false);
  });
});
