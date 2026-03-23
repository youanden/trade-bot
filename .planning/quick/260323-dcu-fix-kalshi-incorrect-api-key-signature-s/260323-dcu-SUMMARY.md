---
phase: quick
plan: 260323-dcu
subsystem: exchanges/kalshi
tags: [bug-fix, kalshi, authentication, signing]
dependency_graph:
  requires: []
  provides: [kalshi-auth-fix]
  affects: [kalshi-client]
tech_stack:
  added: []
  patterns: [new URL().pathname for dynamic path prefix extraction]
key_files:
  modified:
    - src/worker/core/exchanges/kalshi/client.ts
decisions:
  - "Extract /trade-api/v2 prefix dynamically from this.baseUrl via new URL().pathname rather than hardcoding — works for both prod and demo environments"
metrics:
  duration: "2m"
  completed_date: "2026-03-23"
  tasks_completed: 1
  files_modified: 1
---

# Quick Task 260323-dcu: Fix Kalshi INCORRECT_API_KEY_SIGNATURE

**One-liner:** Fixed RSA-PSS signature to include /trade-api/v2 base path prefix extracted dynamically from baseUrl via new URL().pathname.

## What Was Done

Kalshi's API requires the full URL path (including the base path `/trade-api/v2`) when computing the RSA-PSS request signature. The `sign()` method was only signing the relative path (e.g., `/portfolio/orders`), causing every authenticated request to fail with `INCORRECT_API_KEY_SIGNATURE`.

## Changes

**`src/worker/core/exchanges/kalshi/client.ts`** — `sign()` method (lines 229-233):

Before:
```typescript
const pathNoQuery = path.split("?")[0];
const message = timestampMs + method.toUpperCase() + pathNoQuery;
```

After:
```typescript
const pathNoQuery = path.split("?")[0];
const basePathPrefix = new URL(this.baseUrl).pathname;
const message = timestampMs + method.toUpperCase() + basePathPrefix + pathNoQuery;
```

The fix extracts `/trade-api/v2` from `this.baseUrl` using `new URL().pathname`, so the signed message becomes `{timestamp}GET/trade-api/v2/portfolio/orders` which matches the actual request URL `https://api.elections.kalshi.com/trade-api/v2/portfolio/orders`.

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1: Fix sign() to include baseUrl pathname prefix | 0a595f7 | src/worker/core/exchanges/kalshi/client.ts |

## Self-Check: PASSED

- [x] `src/worker/core/exchanges/kalshi/client.ts` exists and contains `new URL(this.baseUrl).pathname`
- [x] `basePathPrefix + pathNoQuery` present in message construction
- [x] Commit 0a595f7 exists
- [x] Pre-existing TypeScript errors in unrelated simulation files (engine.ts, types.ts) are not caused by this change
