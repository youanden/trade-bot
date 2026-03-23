---
phase: 09-add-discord-trade-notifications-and-leaderboard-copy-strategy
plan: "02"
subsystem: core/exchanges/polymarket
tags: [leaderboard, polymarket, copy-trader, api-client, config]
dependency_graph:
  requires: []
  provides:
    - src/worker/core/exchanges/polymarket/leaderboard.ts
    - CopyTraderConfig leaderboard fields
  affects:
    - src/worker/bots/copy-trader/strategy.ts (Plan 03 will consume)
tech_stack:
  added: []
  patterns:
    - native fetch for public API (no auth)
    - globalThis.fetch override for bun:test isolation
    - optional interface fields for backward-compatible config extension
key_files:
  created:
    - src/worker/core/exchanges/polymarket/leaderboard.ts
    - test/core/leaderboard.test.ts
  modified:
    - src/worker/bots/copy-trader/config.ts
decisions:
  - "fetchLeaderboard uses native fetch with no npm dependencies — aligns with locked decision D-02"
  - "proxyWallet normalized to lowercase in leaderboard.ts to prevent address casing mismatch (Pitfall 2)"
  - "userName defaults to proxyWallet (lowercased) when API returns empty string"
  - "5 leaderboard fields all optional — preserves backward compat with existing CopyTraderConfig consumers"
  - "No defaults added to DEFAULT_COPY_TRADER_CONFIG — fields are opt-in, defaults applied at usage site in Plan 03"
metrics:
  duration: "80s"
  completed: "2026-03-23T00:58:22Z"
  tasks: 2
  files: 3
---

# Phase 09 Plan 02: Polymarket Leaderboard Client and Config Extension Summary

**One-liner:** Polymarket leaderboard API client with address normalization and TDD test suite, plus CopyTraderConfig extended with 5 optional leaderboard mode fields.

## What Was Built

### Task 1: Polymarket Leaderboard API Client (TDD)

Created `src/worker/core/exchanges/polymarket/leaderboard.ts` — a standalone async function module that fetches top trader rankings from the Polymarket public data API.

**Exports:**
- `LeaderboardEntry` — typed record shape: `{ rank: number; proxyWallet: string; userName: string; pnl: number; vol: number }`
- `LeaderboardParams` — query parameters interface with optional `timePeriod`, `orderBy`, `limit`, `offset`, `category`
- `fetchLeaderboard(params?)` — fetches `https://data-api.polymarket.com/v1/leaderboard` and maps raw response to `LeaderboardEntry[]`

**Edge cases handled:**
- String `rank` coerced to number via `Number(e.rank)`
- `proxyWallet` normalized to lowercase (prevents address casing mismatch)
- Empty `userName` defaults to `proxyWallet` (lowercase)
- Null `vol` and `pnl` default to `0` (API omits fields when ordering by the other metric)
- Non-ok responses throw `new Error("Leaderboard API {status}: {body}")`
- Zero npm dependencies — native `fetch` only

**Test file:** `test/core/leaderboard.test.ts` with 7 test cases covering all behaviors. Uses `globalThis.fetch` override pattern (beforeEach/afterEach) consistent with bun:test constraints.

### Task 2: CopyTraderConfig Extension

Added 5 optional fields to `CopyTraderConfig` in `src/worker/bots/copy-trader/config.ts`:
- `leaderboardMode?: boolean` — opt-in flag for leaderboard-driven trader discovery
- `leaderboardRefreshMs?: number` — refresh interval in ms (default 1h applied at usage site in Plan 03)
- `leaderboardTopN?: number` — number of top traders to copy (default 10 applied in Plan 03)
- `leaderboardTimePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL"` — ranking window
- `_lastLeaderboardRefresh?: string` — ISO-8601 last-refresh timestamp for the refresh guard

No defaults added to `DEFAULT_COPY_TRADER_CONFIG` — these fields are opt-in; Plan 03 applies defaults at the strategy usage site.

## Commits

| Hash | Description |
|------|-------------|
| 4ae177c | test(09-02): add failing leaderboard client tests (RED) |
| 3a02f41 | feat(09-02): implement Polymarket leaderboard API client |
| f3084db | feat(09-02): extend CopyTraderConfig with leaderboard mode fields |

## Verification

- `bun test test/core/leaderboard.test.ts` — 7 pass, 0 fail
- `grep "leaderboardMode" src/worker/bots/copy-trader/config.ts` — confirmed
- `grep "fetchLeaderboard" src/worker/core/exchanges/polymarket/leaderboard.ts` — confirmed
- No new npm dependencies added

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all exports are fully implemented with real behavior.

## Self-Check: PASSED

Files exist:
- `src/worker/core/exchanges/polymarket/leaderboard.ts` — FOUND
- `test/core/leaderboard.test.ts` — FOUND
- `src/worker/bots/copy-trader/config.ts` — FOUND (modified)

Commits exist:
- 4ae177c — FOUND
- 3a02f41 — FOUND
- f3084db — FOUND
