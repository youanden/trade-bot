---
phase: 08-implement-actionable-improvements-from-polymarket-ecosystem-analysis
plan: 01
subsystem: exchanges/polymarket
tags: [hmac, authentication, error-handling, polymarket, clob]
dependency_graph:
  requires: []
  provides:
    - src/worker/core/exchanges/polymarket/hmac.ts
    - src/worker/core/exchanges/polymarket/errors.ts
  affects:
    - src/worker/core/exchanges/polymarket/client.ts
tech_stack:
  added: []
  patterns:
    - Extracted HMAC signing into standalone testable module
    - Structured error class with retry/auth classification getters
key_files:
  created:
    - src/worker/core/exchanges/polymarket/hmac.ts
    - src/worker/core/exchanges/polymarket/errors.ts
    - test/core/polymarket-client.test.ts
  modified:
    - src/worker/core/exchanges/polymarket/client.ts
decisions:
  - "Extract HMAC signing to standalone buildHmacSignature function to enable isolated unit testing without full client instantiation"
  - "ClobApiError placed in separate errors.ts file (not types.ts) following module-per-concern convention"
metrics:
  duration: 2 minutes
  completed: 2026-03-22
  tasks_completed: 2
  files_changed: 4
---

# Phase 08 Plan 01: Fix HMAC Auth Bug and Add Structured Error Handling Summary

Fixed two HMAC authentication bugs in the Polymarket CLOB client and added ClobApiError structured error class with isRetryable/isAuthError classification.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create hmac.ts, errors.ts, and unit tests | 04906ca | hmac.ts, errors.ts, polymarket-client.test.ts |
| 2 | Integrate hmac.ts and errors.ts into PolymarketClient.clobFetch | 98b78a8 | client.ts |

## What Was Built

**`src/worker/core/exchanges/polymarket/hmac.ts`** — Standalone HMAC-SHA256 signing function `buildHmacSignature`. Fixes two bugs from the original inline implementation:
1. Secret is now base64-decoded (`atob(normalized)`) before use as HMAC key material — previously used raw UTF-8 encoding which produced invalid signatures
2. Output is URL-safe base64 (`.replace(/\+/g, "-").replace(/\//g, "_")`) — previously used standard base64 with `+` and `/` which were rejected by the CLOB API

**`src/worker/core/exchanges/polymarket/errors.ts`** — `ClobApiError extends Error` with `status`, `context`, `body` fields and `isRetryable` / `isAuthError` getters. Enables callers to distinguish retryable server errors (429, 5xx) from permanent client errors (4xx).

**`test/core/polymarket-client.test.ts`** — 18 unit tests covering URL-safe base64 output, deterministic signing, and all error classification cases.

**`src/worker/core/exchanges/polymarket/client.ts`** — Updated `clobFetch` to use `buildHmacSignature` (removes old inline HMAC code) and throw `ClobApiError` instead of generic `Error`.

## Verification Results

- `bun test test/core/polymarket-client.test.ts`: 18/18 pass
- `bun test` (full suite): 133/133 pass, no regressions
- `grep -c "TextEncoder.*apiSecret" client.ts`: 0 (old bug removed)
- `grep -c "buildHmacSignature" client.ts`: 2 (import + call)
- `grep -c "ClobApiError" client.ts`: 2 (import + throw)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all new code is fully wired and functional.

## Self-Check: PASSED

Files exist:
- FOUND: src/worker/core/exchanges/polymarket/hmac.ts
- FOUND: src/worker/core/exchanges/polymarket/errors.ts
- FOUND: test/core/polymarket-client.test.ts

Commits exist:
- FOUND: 04906ca (feat(08-01): create hmac.ts, errors.ts, and unit tests)
- FOUND: 98b78a8 (feat(08-01): integrate hmac.ts and errors.ts into PolymarketClient.clobFetch)
