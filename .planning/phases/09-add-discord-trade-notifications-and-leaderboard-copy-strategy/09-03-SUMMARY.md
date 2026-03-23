---
phase: 09-add-discord-trade-notifications-and-leaderboard-copy-strategy
plan: "03"
subsystem: bots/copy-trader
tags: [discord, leaderboard, copy-trader, notifications, integration]
dependency_graph:
  requires:
    - 09-01 (discord.ts + TradeNotification interface)
    - 09-02 (leaderboard.ts + CopyTraderConfig leaderboard fields)
  provides:
    - Discord notifications wired into copyTraderTick
    - Leaderboard refresh wired into copyTraderTick
  affects:
    - src/worker/bots/copy-trader/strategy.ts
    - test/strategies/copy-trader.test.ts
tech_stack:
  added: []
  patterns:
    - fire-and-forget notifyDiscord after recordTrade guarded by env.DISCORD_WEBHOOK_URL
    - maybeRefreshLeaderboard helper with elapsed-time guard (config._lastLeaderboardRefresh)
    - buildPortfolioSummary queries positions and trades tables for embed footer
    - globalThis.fetch spy (fetchCalls array) for integration test isolation
    - select-then-insert/update upsert pattern (no unique constraint on tracked_traders)
key_files:
  created: []
  modified:
    - src/worker/bots/copy-trader/strategy.ts
    - test/strategies/copy-trader.test.ts
decisions:
  - "Guard Discord notification with env.DISCORD_WEBHOOK_URL presence check — no notification when webhook not configured"
  - "Guard leaderboard refresh with config.leaderboardMode flag — opt-in, no change for existing configs"
  - "Early return after leaderboard refresh when traderIds still empty — prevents exchange client creation for nothing"
  - "buildPortfolioSummary uses botInstanceId from config.dbBotId — returns zeros when absent (test mode)"
metrics:
  duration: "129s"
  completed: "2026-03-23"
  tasks_completed: 2
  files_modified: 2
---

# Phase 09 Plan 03: Copy-Trader Discord and Leaderboard Integration Summary

## One-liner

Discord trade notifications and Polymarket leaderboard refresh wired into copyTraderTick with env-guarded fire-and-forget notification and interval-guarded leaderboard upsert.

## What Was Built

### Task 1: Integrate Discord notifications and leaderboard refresh into copyTraderTick

Modified `src/worker/bots/copy-trader/strategy.ts` with three additions:

**Imports added:**
- `notifyDiscord` and `TradeNotification` from `../../core/notifications/discord`
- `fetchLeaderboard` from `../../core/exchanges/polymarket/leaderboard`
- `positions` and `trades` from `../../core/db/schema` (existing `trackedTraders` import extended)

**`maybeRefreshLeaderboard` helper (LEAD-02):**
- Called at start of `copyTraderTick` when `config.leaderboardMode` is true
- Checks `config._lastLeaderboardRefresh` against `config.leaderboardRefreshMs ?? 3_600_000`
- Fetches leaderboard with `timePeriod`, `orderBy: "PNL"`, `limit: config.leaderboardTopN ?? 10`
- Upserts entries to `tracked_traders` table using select-then-insert/update (no unique constraint exists)
- Updates `config.traderIds` and `config._lastLeaderboardRefresh` in-place
- Calls `bot.updateConfig(config)` if available to persist timestamp
- Errors swallowed with `log.error` — strategy continues without traders rather than crashing

**`buildPortfolioSummary` helper:**
- Queries `positions` (open, botInstanceId filtered) and `trades` for equity/pnl/fees
- Returns 7-field portfolio snapshot used in notification embed footer
- Falls back to empty arrays when `botInstanceId` is undefined (safe for test mode)

**Discord notification in `processTrader` (DISC-04):**
- After each `recordTrade` call (both buy-copy and sell-copy branches)
- Guarded by `if (env.DISCORD_WEBHOOK_URL)` — no-op when webhook not configured
- Calls `buildPortfolioSummary` then `notifyDiscord` with `COPY_BUY` or `COPY_SELL` trade type
- `fee: 0` — fee not available from `OrderResult`; correct value requires exchange-specific logic
- `pnl: undefined` on buys (no realized P&L until position closed)

**Early-return guard added:** After leaderboard refresh, if `traderIds` is still empty the tick returns before creating an exchange client.

### Task 2: Add integration tests for Discord and leaderboard (TDD)

Extended `test/strategies/copy-trader.test.ts` with 6 new tests in 2 new describe blocks:

**describe "discord notifications" (2 tests):**
- `calls Discord webhook after trade when DISCORD_WEBHOOK_URL is set` — fetch spy asserts a Discord webhook URL was called after a position delta triggers a buy trade
- `does not call Discord webhook when DISCORD_WEBHOOK_URL is absent` — asserts zero discord.com fetch calls when env has no webhook URL

**describe "leaderboard mode" (4 tests):**
- `refreshes leaderboard and populates tracked_traders on first tick` — leaderboard API called, DB row inserted with lowercase address
- `skips leaderboard refresh when interval has not elapsed` — `_lastLeaderboardRefresh: new Date().toISOString()` prevents any leaderboard fetch call
- `stores leaderboard-sourced traders with lowercase address` — inserted `traderId` equals its own `.toLowerCase()`
- `updates existing tracked_trader row on subsequent leaderboard refresh` — pre-inserted row updated (alias + totalPnl), no duplicate created

All tests use `globalThis.fetch` override in `beforeEach`/`afterEach` to intercept the three external HTTP targets: leaderboard API, positions API, Discord webhook.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | b8a33de | feat(09-03): integrate Discord notifications and leaderboard refresh into copyTraderTick |
| 2 | dec7d21 | test(09-03): add Discord and leaderboard integration tests for copy-trader strategy |

## Verification Results

```
bun test test/core/discord.test.ts test/core/leaderboard.test.ts test/strategies/copy-trader.test.ts
 24 pass
 0 fail
 65 expect() calls
Ran 24 tests across 3 files.

bun test (full suite)
 160 pass
 0 fail
 2846 expect() calls
Ran 160 tests across 20 files.
```

## Deviations from Plan

**1. [Rule 2 - Auto-add missing functionality] Early-return guard after leaderboard refresh**
- **Found during:** Task 1 implementation
- **Issue:** When `leaderboardMode: true` and `traderIds: []`, after a failed or empty leaderboard fetch `config.traderIds` remains empty. Without a guard, the code would proceed to create an exchange client and enter a zero-iteration loop — wasteful and misleading.
- **Fix:** Added `if (!config?.traderIds?.length) return;` after the `maybeRefreshLeaderboard` call
- **Files modified:** `src/worker/bots/copy-trader/strategy.ts`
- **Commit:** b8a33de

**2. [Rule 1 - Bug] Early-return condition adjusted for leaderboardMode**
- **Found during:** Task 1 review
- **Issue:** Original guard `if (!config?.traderIds?.length)` would prevent leaderboard-mode bots from ever running (they start with empty `traderIds`)
- **Fix:** Changed to `if (!config?.traderIds?.length && !config?.leaderboardMode)` so leaderboard-mode bots are not rejected at entry
- **Files modified:** `src/worker/bots/copy-trader/strategy.ts`
- **Commit:** b8a33de

## Known Stubs

**`fee: 0` in Discord notification** — The `OrderResult` type does not include a fee field. Fee calculation requires platform-specific logic (e.g., Polymarket CLOB fee schedule). This is intentional — fee display shows $0.00 in embeds rather than crashing or blocking the notification. A future plan can wire actual fee calculation when needed.

## Self-Check: PASSED
