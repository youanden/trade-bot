---
phase: quick
plan: 260322-uyr
subsystem: copy-trader, kalshi-exchange
tags: [kalshi, leaderboard, copy-trader, crowd-wisdom]
dependency_graph:
  requires: []
  provides: [kalshi-leaderboard-module, kalshi-copy-trader-leaderboard-mode]
  affects: [copy-trader-strategy]
tech_stack:
  added: []
  patterns: [crowd-wisdom-via-volume-ranking, platform-branching-in-strategy]
key_files:
  created:
    - src/worker/core/exchanges/kalshi/leaderboard.ts
  modified:
    - src/worker/bots/copy-trader/config.ts
    - src/worker/bots/copy-trader/strategy.ts
decisions:
  - "Kalshi crowd-wisdom uses volume-ranked markets as trader proxies — no public trader leaderboard exists"
  - "dominantSide derived from last_price_dollars > 0.50 — simple, deterministic, no extra API calls"
  - "Synthetic position size=1 is a pure signal; actual sizing left to sizeFraction/maxPositionSize in processTrader"
  - "fetchTraderPositions falls back to [] on any error (same pattern as Polymarket)"
  - "maybeRefreshLeaderboard returns early after Kalshi branch to avoid running Polymarket logic"
metrics:
  duration: "~3 minutes"
  completed: "2026-03-22"
  tasks: 2
  files: 3
---

# Quick Task 260322-uyr: Implement Kalshi Leaderboard Copy Trading Summary

**One-liner:** Crowd-wisdom Kalshi leaderboard using volume-ranked markets and price-skew signals as trade signals for the copy-trader bot.

## What Was Built

Kalshi has no public trader leaderboard. This implements an alternative: fetch the top Kalshi markets by volume (crowd wisdom), derive a YES/NO trade signal from the dominant price side, and feed that signal through the existing copy-trader pipeline.

### Task 1: Kalshi Leaderboard Module + Config Update

Created `src/worker/core/exchanges/kalshi/leaderboard.ts`:
- `fetchKalshiLeaderboard(params)` — calls public `GET /markets` endpoint with `status=open`, filters by `minVolume`, sorts by volume descending, slices to `limit`
- `KalshiLeaderboardEntry` — ticker, title, volume, volume24h, openInterest, dominantSide, dominantPrice
- `KalshiLeaderboardParams` — limit, minVolume, category, status

Added to `CopyTraderConfig`:
- `kalshiMinVolume?: number` — volume filter threshold (default 1000 in strategy)
- `kalshiCategory?: string` — optional Kalshi category filter

### Task 2: Strategy Integration

Updated `src/worker/bots/copy-trader/strategy.ts`:
- `maybeRefreshLeaderboard` is now platform-aware: Kalshi branch calls `fetchKalshiLeaderboard`, upserts market tickers as "traders" into `trackedTraders` table, then returns early so Polymarket path is never touched
- `fetchTraderPositions` for Kalshi: fetches `GET /markets/{ticker}` (public), reads `last_price_dollars`, returns `[{ marketId: ticker, outcome: "yes"|"no", size: 1 }]` as a synthetic position signal
- Polymarket behavior: completely unchanged (no modifications to existing Polymarket code paths)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data is wired from the live Kalshi public markets API. The `size: 1` synthetic position is intentional design (documented in plan), not a stub.

## Self-Check

- [x] `src/worker/core/exchanges/kalshi/leaderboard.ts` exists with correct exports
- [x] `CopyTraderConfig` has `kalshiMinVolume` and `kalshiCategory`
- [x] `strategy.ts` imports `fetchKalshiLeaderboard` and `KALSHI_URLS`
- [x] TypeScript: only pre-existing errors in `simulation/` (unrelated files)
- [x] Commits: 22ba34e (Task 1), 752a1d3 (Task 2)

## Self-Check: PASSED
