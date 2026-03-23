---
phase: quick
plan: 260322-vu7
subsystem: bots/market-maker, core/exchanges/kalshi
tags: [market-maker, kalshi, bug-fix, dynamic-discovery]
dependency_graph:
  requires: []
  provides: [dynamic-market-discovery, kalshi-orderbook-guard]
  affects: [market-maker strategy, kalshi client]
tech_stack:
  added: []
  patterns: [optional-config-fields, defensive-null-check, dynamic-discovery-sort]
key_files:
  created: []
  modified:
    - src/worker/core/exchanges/kalshi/client.ts
    - src/worker/bots/market-maker/config.ts
    - src/worker/bots/market-maker/strategy.ts
decisions:
  - "Guard data.orderbook before destructuring — returns empty book rather than crashing on undefined"
  - "marketIds optional with ?? [] fallback — backward-compatible with bots that have explicit IDs"
  - "Discovery: limit 100 active markets, filter minVolume, sort volume desc, slice maxMarkets — deterministic top-N selection"
metrics:
  duration: "~5 minutes"
  completed: "2026-03-22"
  tasks: 2
  files: 3
---

# Quick Task 260322-vu7: Fix Market-Maker to Discover Markets Dynamically

**One-liner:** Kalshi getOrderBook now guards undefined orderbook with empty fallback, and market-maker auto-discovers top-N active markets by volume when marketIds is absent.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Guard Kalshi orderbook and update market-maker config | 828a211 | src/worker/core/exchanges/kalshi/client.ts, src/worker/bots/market-maker/config.ts |
| 2 | Add dynamic market discovery to market-maker strategy | 017e48d | src/worker/bots/market-maker/strategy.ts |

## What Was Done

### Task 1: Kalshi orderbook guard + config updates

**`src/worker/core/exchanges/kalshi/client.ts`** — `getOrderBook()`:
- Added `if (!data.orderbook) { return { bids: [], asks: [] }; }` guard before accessing `data.orderbook`.
- Prevents crash when Kalshi API returns a response body with no `orderbook` key (e.g., settled or inactive markets).

**`src/worker/bots/market-maker/config.ts`** — `MarketMakerConfig`:
- `marketIds` changed from `string[]` (required) to `marketIds?: string[]` (optional).
- Added `maxMarkets?: number` — max auto-discovered markets per tick, default 5.
- Added `minVolume?: number` — minimum volume filter for discovered markets, default 0.
- Added `maxMarkets: 5` and `minVolume: 0` to `DEFAULT_MARKET_MAKER_CONFIG`.

### Task 2: Dynamic market discovery in strategy

**`src/worker/bots/market-maker/strategy.ts`** — `marketMakerTick()`:
- Removed the early-return block `if (!config.marketIds?.length)`.
- Moved exchange client creation before market ID resolution.
- When `marketIds` is absent or empty:
  - Calls `client.getMarkets({ limit: 100, status: "active" })`.
  - Filters markets by `minVolume` (default 0).
  - Sorts by `volume` descending.
  - Takes top `maxMarkets` (default 5).
  - Maps to `platformId` strings.
  - Logs discovery count and IDs at info level.
  - On discovery error: logs and returns early.
- Added second guard `if (marketIds.length === 0)` after discovery to handle empty exchange.
- `for` loop iterates over local `marketIds` variable (not `config.marketIds`).
- Bots with explicit `marketIds` continue to work exactly as before.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Pre-existing Issues (Out of Scope)

TypeScript errors in `src/worker/core/simulation/engine.ts` and `src/worker/core/simulation/types.ts` were present before this task and are unrelated to the changes made. No errors exist in the three modified files.

## Self-Check: PASSED

- `src/worker/core/exchanges/kalshi/client.ts` — exists, contains `data.orderbook` guard
- `src/worker/bots/market-maker/config.ts` — exists, contains `maxMarkets`
- `src/worker/bots/market-maker/strategy.ts` — exists, contains `getMarkets` call
- Commits 828a211 and 017e48d verified in git log
