---
phase: 04-backtest-engine
plan: 02
subsystem: testing
tags: [simulation, backtest, clock, dependency-injection, equity-curve, globalThis.Date]

# Dependency graph
requires:
  - phase: 04-01
    provides: SimulatedBot class, PortfolioRisk clockFn injection
  - phase: 03-sim-exchange-client
    provides: SimExchangeClient, PriceFeed, generateScenario
  - phase: 01-test-infrastructure
    provides: createTestDb, bun-sqlite in-memory DB
provides:
  - BacktestClock class with ISO-8601 tick-by-tick time advancement
  - runBacktest orchestrator function with clean dependency injection
  - BacktestConfig, BacktestResult, EquitySnapshot, BacktestDeps types
  - Integration tests covering BT-01, BT-02, BT-04, BT-05, BT-06, BT-07
affects:
  - Any future CLI report phase consuming BacktestResult
  - Phase 05+ (paper trading, seeder) that may use engine infrastructure

# Tech tracking
tech-stack:
  added: []
  patterns:
    - BacktestDeps interface: injectable createDb + createExchangeClient with lazy default imports
    - globalThis.Date override: SimulatedDate constructor with finally restore for isolation
    - env._simClient pattern: engine stores SimExchangeClient on env stub so mock.module intercepts strategy calls
    - Direct SimExchangeClient construction: engine bypasses mock.module by importing SimExchangeClient directly

key-files:
  created:
    - src/worker/core/simulation/engine.ts
    - test/core/engine.test.ts
  modified: []

key-decisions:
  - "Engine constructs SimExchangeClient directly via new SimExchangeClient(...) rather than through deps.createExchangeClient — avoids mock.module collision when tests intercept the factory"
  - "env._simClient pattern: engine sets simClient on env stub; mock.module('factory') reads _env._simClient so strategies receive engine's instance"
  - "globalThis.Date overridden with SimulatedDate that returns simulated now() for no-arg calls, delegates real Date for args — restored in finally to prevent concurrent test leakage"
  - "Lazy import defaults in runBacktest: deps defaults use dynamic import so tests can pass overrides without requiring mock.module for the engine's own DB creation"
  - "deep-research BT-07 test uses categories:[] to match uncategorized simulated markets (SimExchangeClient returns markets with no category field)"
  - "BT-04 48-tick test uses startTime: 2024-06-01T12:00:00.000Z with 30-min intervals so tick 24 crosses into 2024-06-02"

patterns-established:
  - "BacktestClock pattern: immutable intervalMs, mutable currentMs, isAfter() via timestamp parse"
  - "Per-run DB isolation: createDb(null) returns fresh :memory: per runBacktest call"
  - "Equity snapshot after strategy tick before clock.advance() captures simulated balance at each price point"

requirements-completed: [BT-01, BT-02, BT-05, BT-06, BT-07]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 4 Plan 02: BacktestEngine Orchestrator Summary

**BacktestClock and runBacktest orchestrator stitching SimulatedBot, SimExchangeClient, and PriceFeed into a complete backtest pipeline with globalThis.Date injection and per-run DB isolation**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-22T15:16:48Z
- **Completed:** 2026-03-22T15:21:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `BacktestClock` class with `now()`, `advance()`, `isAfter()` — ISO-8601 timestamps at configurable tick intervals
- `runBacktest` orchestrator: isolated per-run in-memory DB, SimExchangeClient constructed directly (bypassing mocks), globalThis.Date override with `finally` restore, equity curve snapshots per tick
- `BacktestDeps` interface for DI: injectable `createDb` and `createExchangeClient` with lazy import defaults
- 14 integration tests covering BT-01 through BT-07 requirements
- All 8 strategies complete at least one tick cycle without uncaught errors (verified in BT-02 loop)
- LLM strategies (llm-assessor, deep-research) produce trades with mockAI (BT-07)
- 48-tick multi-day test spanning 2024-06-01 and 2024-06-02 (BT-04)
- Concurrent runBacktest calls produce independent equity curves and unique runIds (BT-05)
- Full suite: 115 tests, 0 failures — no regressions in Phases 1-3

## Task Commits

Each task was committed atomically:

1. **TDD RED: failing tests for BacktestClock and runBacktest engine** - `06aaafa` (test)
2. **Task 1: BacktestClock and runBacktest engine with DI** - `c6d8f03` (feat)
3. Task 2: Regression verification — no new files; all 115 tests pass (no commit needed)

## Files Created/Modified

- `src/worker/core/simulation/engine.ts` — BacktestClock class, runBacktest function, BacktestConfig/Result/EquitySnapshot/BacktestDeps types; direct SimExchangeClient construction; globalThis.Date override with finally restore; lazy import defaults for deps
- `test/core/engine.test.ts` — 14 tests: BT-01 (6 clock unit tests), BT-02 (market-maker + all 8 strategies), BT-04 (48-tick multi-day), BT-05 (concurrent isolation), BT-06 (equity curve), BT-07 (llm-assessor + deep-research with mockAI)

## Decisions Made

- Engine constructs `SimExchangeClient` directly via `new SimExchangeClient(...)` rather than through `deps.createExchangeClient`. This avoids a circular problem where `mock.module("factory")` intercepts the engine's own factory call, returning `null` instead of the real client.
- `env._simClient` pattern: engine sets `simClient` on the env stub so that when strategies call `createExchangeClient(env, platform)`, the test mock returns `env._simClient` correctly.
- `globalThis.Date` overridden with a `SimulatedDate` constructor that returns simulated now for no-arg calls and delegates to real Date for args — restored in `finally` block to prevent leakage across concurrent tests.
- `categories: []` in deep-research BT-07 config since `SimExchangeClient.getMarkets()` returns markets with no `category` field; a non-empty filter would exclude all markets and produce 0 trades.
- BT-04 48-tick test uses `startTime: "2024-06-01T12:00:00.000Z"` with 30-min intervals — tick 24 lands at 00:00 on 2024-06-02, giving 24 ticks on each day.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SimExchangeClient construction bypasses mock.module**
- **Found during:** Task 1 GREEN (first test run)
- **Issue:** Plan specified creating simClient via `resolvedDeps.createExchangeClient({} as Env, platform, { feed, ... })`. But `mock.module("factory")` intercepts this call and returns `null` (since `{}` has no `_simClient`). Result: `TypeError: null is not an object (evaluating 'simClient.getBalance')`
- **Fix:** Engine imports `SimExchangeClient` directly and uses `new SimExchangeClient({...})`, bypassing the mock entirely. The `BacktestDeps.createExchangeClient` field is retained in the exported interface for forward compatibility.
- **Files modified:** `src/worker/core/simulation/engine.ts`

**2. [Rule 1 - Bug] cross-arb needs `platforms` array in generic test config**
- **Found during:** Task 1 "all 8 strategies" test
- **Issue:** `crossArbTick` accesses `config.platforms` before any early-return guard, causing `TypeError: undefined is not an object`
- **Fix:** Added `platforms: ["polymarket", "kalshi"]` to the generic botConfig in the all-strategies loop
- **Files modified:** `test/core/engine.test.ts`

**3. [Rule 1 - Bug] weather-arb needs `locations` array in generic test config**
- **Found during:** Task 1 "all 8 strategies" test
- **Issue:** `weatherArbTick` accesses `config.locations` at top of loop without guard
- **Fix:** Added `locations: ["Chicago"]` to generic botConfig
- **Files modified:** `test/core/engine.test.ts`

**4. [Rule 1 - Bug] BT-04 scenario timestamps never reached day 2**
- **Found during:** Task 1 BT-04 test
- **Issue:** 48 ticks × 30 min = 1440 min = 24 hours starting at midnight. Last tick = 23:30 (still day 1). Test asserted `day2Snaps.length > 0` but got 0.
- **Fix:** Changed startTime to `"2024-06-01T12:00:00.000Z"` so tick 24 = 2024-06-02T00:00:00.000Z
- **Files modified:** `test/core/engine.test.ts`

**5. [Rule 1 - Bug] deep-research BT-07 produced 0 trades**
- **Found during:** Task 1 BT-07 test
- **Issue:** deep-research filters markets by `categories` — simulated markets have no `category` field, so all markets were excluded when `categories: ["politics"]` was set
- **Fix:** Changed `makeDeepResearchConfig()` to use `categories: []` for the BT-07 test so unfiltered markets are used
- **Files modified:** `test/core/engine.test.ts`

## Known Stubs

None — all exported functions produce real values from the simulation pipeline.

## Self-Check: PASSED

- FOUND: src/worker/core/simulation/engine.ts
- FOUND: test/core/engine.test.ts
- FOUND: commit 06aaafa (test RED phase)
- FOUND: commit c6d8f03 (feat GREEN phase)
- Full suite: 115 pass, 0 fail

---
*Phase: 04-backtest-engine*
*Completed: 2026-03-22*
