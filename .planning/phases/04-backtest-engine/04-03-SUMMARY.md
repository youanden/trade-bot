---
phase: 04-backtest-engine
plan: 03
subsystem: test
tags: [backtest, circuit-breaker, risk, simulation, tdd]
dependency_graph:
  requires: [04-02]
  provides: [BT-04-verified]
  affects: []
tech_stack:
  added: []
  patterns:
    - Manual engine tick loop in test for custom strategy injection
    - Direct position seeding to trigger circuit breaker
    - SimulatedDate override + finally restore pattern (reused from engine)
key_files:
  created: []
  modified:
    - test/core/engine.test.ts
decisions:
  - "Manual tick loop in BT-04 test (not runBacktest) allows custom strategy injection without registry modification"
  - "PortfolioRisk constructed with default clockFn in test — SimulatedDate override ensures correct simulated-time behavior"
metrics:
  duration: "< 5 min"
  completed: "2026-03-22"
  tasks_completed: 1
  files_modified: 1
---

# Phase 04 Plan 03: BT-04 Circuit Breaker Gap Closure Summary

Circuit-breaker fire-and-reset scenario proven end-to-end in engine-level integration test: losing positions seeded on day 1 trigger `isDailyLossBreached()`, blocking trading until midnight resets the window on day 2.

## Objective

Close the BT-04 verification gap identified in `04-VERIFICATION.md`. The existing test only checked that equity curve timestamps spanned two days — it never actually triggered `isDailyLossBreached()`. The underlying `PortfolioRisk` clock injection was confirmed in `sim-bot.test.ts`, but the engine-level "fire and reset" story was unproven.

## Tasks Completed

| # | Task | Status | Commit | Files |
|---|------|--------|--------|-------|
| 1 | Rewrite BT-04 engine test to exercise circuit-breaker fire-and-reset | Done | 3de2074 | test/core/engine.test.ts |

## What Was Built

The BT-04 `describe` block in `test/core/engine.test.ts` was replaced with a new test that:

1. Generates a 48-tick flat scenario starting 2024-06-01T12:00:00Z (day 1 = ticks 0-23, day 2 = ticks 24-47)
2. Manually replicates the engine tick loop (DB creation, scenario seeding, `SimulatedDate` override, tick loop, cleanup) with a custom `circuitBreakerStrategy` function instead of calling `runBacktest()`
3. On tick 3 (still day 1): inserts a closed position with `unrealizedPnl: -600` and `closedAt` set to simulated now (2024-06-01), exceeding market-maker `maxDailyLoss` of 500
4. On each tick: instantiates `PortfolioRisk` (default `clockFn` → uses `new Date()` → `SimulatedDate` → simulated time) and calls `isDailyLossBreached()`
5. Asserts:
   - `breakerFiredOnDay1 === true`
   - `tradesBeforeBreaker > 0` (ticks 1-2 before seeding)
   - `tradesOnDay2 > 0` (trading resumes on 2024-06-02)
   - `bot._tradeCount === tradesBeforeBreaker + tradesOnDay2` (no trades during breaker period)

## Verification

All verification checks pass:

```
bun test test/core/engine.test.ts  → 14 pass, 0 fail
bun test                           → 115 pass, 0 fail
grep "isDailyLossBreached" test/core/engine.test.ts  → 1 match (line 369)
grep "breakerFiredOnDay1" test/core/engine.test.ts   → 3 matches (239, 372, 421)
grep "tradesOnDay2" test/core/engine.test.ts         → 4 matches (241, 391, 427, 430)
grep "unrealizedPnl.*-600" test/core/engine.test.ts  → 2 matches (349, 361)
```

The circuit-breaker warnings in test output (`circuit-breaker:daily-loss` at 13:00–23:30 on 2024-06-01) confirm `isDailyLossBreached()` fires on day 1, and the absence of warnings on day 2 confirms the reset works correctly.

## Deviations from Plan

None — plan executed exactly as written.

The implementation follows the plan's proposed test structure closely:
- Manual tick loop (not `runBacktest`) for custom strategy control
- Direct `positions` table insert with `unrealizedPnl: -600`, `status: "closed"`, `closedAt` = simulated day 1
- `PortfolioRisk` with default `clockFn` relying on `SimulatedDate` override
- `SimulatedDate` / finally restore pattern matching the engine's own pattern

## Known Stubs

None.

## Self-Check: PASSED

- `test/core/engine.test.ts` exists and has been modified: FOUND
- Commit 3de2074 exists: FOUND
- `bun test test/core/engine.test.ts` exits 0: CONFIRMED (14 pass)
- `bun test` exits 0: CONFIRMED (115 pass)
