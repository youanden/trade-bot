---
phase: 08-implement-actionable-improvements-from-polymarket-ecosystem-analysis
plan: 02
subsystem: exchanges/polymarket
tags: [neg-risk, retry, schema, polymarket, clob, order-routing]
dependency_graph:
  requires:
    - src/worker/core/exchanges/polymarket/errors.ts  # ClobApiError from Plan 01
    - src/worker/core/exchanges/polymarket/hmac.ts    # buildHmacSignature from Plan 01
  provides:
    - src/worker/core/exchanges/polymarket/retry.ts
    - src/worker/core/exchanges/types.ts (isNegRisk field)
  affects:
    - src/worker/core/exchanges/polymarket/client.ts
    - src/worker/core/db/schema.ts
    - drizzle/0001_wild_crusher_hogan.sql
tech_stack:
  added: []
  patterns:
    - Retry wrapper with exponential backoff and ClobApiError classification
    - Neg-risk contract routing via OrderRequest.isNegRisk flag
    - Nullable Polymarket metadata columns on markets table
key_files:
  created:
    - src/worker/core/exchanges/polymarket/retry.ts
    - drizzle/0001_wild_crusher_hogan.sql
  modified:
    - src/worker/core/exchanges/types.ts
    - src/worker/core/exchanges/polymarket/client.ts
    - src/worker/core/db/schema.ts
    - test/core/polymarket-client.test.ts
    - test/core/schema.test.ts
decisions:
  - "withRetry does not retry non-retryable ClobApiErrors (400, 401, 403, 404) — immediate throw prevents wasted retries on permanent failures"
  - "placeOrder and cancelOrder not wrapped with withRetry — non-idempotent operations must never auto-retry to avoid duplicate orders/cancels"
  - "New schema columns are nullable with no default — backward compatible; existing rows get NULL which is correct (no Polymarket metadata for Kalshi markets)"
  - "gammaToMarketInfo continues storing clobTokenIds/negRisk in meta bag — population of new DB columns from meta deferred to market sync task"
metrics:
  duration: 5 minutes
  completed: 2026-03-22
  tasks_completed: 2
  files_changed: 7
---

# Phase 08 Plan 02: Neg-Risk Routing, Retry Logic, and Schema Columns Summary

Added neg-risk exchange contract routing via `OrderRequest.isNegRisk`, `withRetry` utility for idempotent CLOB operations with exponential backoff, and `clobTokenIds`/`negRiskMarketId` nullable columns on the markets table with a Drizzle migration.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add isNegRisk to OrderRequest, create retry.ts, and add tests (TDD) | 51b090e | types.ts, retry.ts, polymarket-client.test.ts |
| 2 | Wire neg-risk routing, retry, and schema columns into client and DB | c4f20c3 | client.ts, schema.ts, schema.test.ts, 0001_wild_crusher_hogan.sql |

## What Was Built

**`src/worker/core/exchanges/polymarket/retry.ts`** — `withRetry<T>` async utility. Retries up to `maxAttempts` (default 3) with exponential backoff (`baseDelayMs * 2^attempt`). Immediately re-throws `ClobApiError` when `isRetryable` is false (400, 401, 403, 404). Retries all generic `Error` instances (network failures, DNS errors) and retryable `ClobApiError` (429, 5xx).

**`src/worker/core/exchanges/types.ts`** — Added `isNegRisk?: boolean` field to `OrderRequest`. When `true`, `placeOrder` signs against `NEG_RISK_EXCHANGE`; when false/absent, signs against `CTF_EXCHANGE` (backward compatible).

**`src/worker/core/exchanges/polymarket/client.ts`** — Three changes:
1. Neg-risk routing: resolves the `// TODO: detect negRisk per market` comment at line 146
2. 8 idempotent methods wrapped with `withRetry`: `getMarkets`, `getMarket`, `getPrice`, `getOrderBook`, `getOrder`, `getOpenOrders`, `getPositions`, `getBalance`
3. `placeOrder` and `cancelOrder` intentionally NOT wrapped

**`src/worker/core/db/schema.ts`** — Added two nullable columns to `markets` table:
- `clobTokenIds text` — stores JSON array of Polymarket token IDs for yes/no outcomes
- `negRiskMarketId text` — stores Gamma API `negRiskMarketID` for neg-risk markets

**`drizzle/0001_wild_crusher_hogan.sql`** — Migration with two `ALTER TABLE markets ADD COLUMN` statements.

## Verification Results

- `bun test test/core/polymarket-client.test.ts`: 23/23 pass (5 new withRetry tests added)
- `bun test` (full suite): 138/138 pass, no regressions
- `grep -c "order.isNegRisk" client.ts`: 1
- `grep -c "withRetry" client.ts`: 9 (1 import + 8 calls)
- `grep -c "clob_token_ids" schema.ts`: 1
- `grep -c "neg_risk_market_id" schema.ts`: 1
- `ls drizzle/0001_*.sql`: drizzle/0001_wild_crusher_hogan.sql

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

**`gammaToMarketInfo` in client.ts** — The method continues to store `clobTokenIds` and `negRisk` in the `meta` bag only. Population of the new DB columns (`clobTokenIds`, `negRiskMarketId`) from `meta` during market sync is intentionally deferred per the plan's note in Task 2, step 5. This is a known gap that requires a follow-on market sync task to wire. The new columns exist in the schema and migration but will remain NULL until that sync logic is added.

## Self-Check: PASSED

Files exist:
- FOUND: src/worker/core/exchanges/polymarket/retry.ts
- FOUND: drizzle/0001_wild_crusher_hogan.sql

Commits exist:
- FOUND: 51b090e (feat(08-02): add isNegRisk to OrderRequest, create retry.ts, add withRetry tests)
- FOUND: c4f20c3 (feat(08-02): wire neg-risk routing, retry, and schema columns into client and DB)
