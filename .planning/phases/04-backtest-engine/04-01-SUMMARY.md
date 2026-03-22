---
phase: 04-backtest-engine
plan: 01
subsystem: testing
tags: [simulation, backtest, drizzle, bun-sqlite, portfolio-risk, duck-typing]

# Dependency graph
requires:
  - phase: 01-test-infrastructure
    provides: createTestDb helper, bun-sqlite in-memory DB pattern
  - phase: 03-sim-exchange-client
    provides: SimExchangeClient, extended factory pattern
provides:
  - SimulatedBot class duck-typing BaseBotDO for backtest execution
  - PortfolioRisk with injectable clockFn for multi-day backtest scenarios
  - Unit tests for SimulatedBot and PortfolioRisk clock injection
affects:
  - 04-02 (backtest engine will instantiate SimulatedBot)
  - any phase needing time-controllable risk checks

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Duck-typed BaseBotDO: SimulatedBot satisfies strategy interface without cloudflare:workers import
    - Synchronous drizzle-orm/bun-sqlite: .all()/.run() not await for TestDb writes
    - Injectable clock: optional () => string param with wall-clock default for backward compat

key-files:
  created:
    - src/worker/core/simulation/sim-bot.ts
    - test/core/sim-bot.test.ts
  modified:
    - src/worker/core/risk/portfolio.ts

key-decisions:
  - "SimulatedBot imports BunSQLiteDatabase from drizzle-orm/bun-sqlite directly, not TestDb from test helpers, keeping src/ clean from test/ imports"
  - "clockFn defaults to () => new Date().toISOString() so all 8 existing strategy PortfolioRisk callers require zero changes"
  - "upsertPosition in SimulatedBot uses synchronous .run()/.all() matching bun-sqlite adapter semantics (no await)"

patterns-established:
  - "SimulatedBot pattern: duck-type target interface without importing Cloudflare-specific base class"
  - "Injectable clock pattern: optional () => string constructor param with sensible default"

requirements-completed: [BT-03, BT-04]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 4 Plan 01: SimulatedBot and PortfolioRisk Clock Injection Summary

**SimulatedBot class duck-typing BaseBotDO for backtest execution, with injectable clockFn in PortfolioRisk enabling correct daily loss circuit-breaker resets across simulated days**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T14:51:13Z
- **Completed:** 2026-03-22T14:54:14Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- SimulatedBot class created in `src/worker/core/simulation/sim-bot.ts` with public config field, recordTrade() that writes to orders/trades/positions tables, and getStatus() — zero cloudflare:workers dependency, runs in bun:test
- PortfolioRisk updated with optional clockFn constructor parameter; isDailyLossBreached uses injectable clock instead of hardcoded `new Date()` — backward compatible, no changes to any of the 8 existing strategy callers
- 13 unit tests added covering all SimulatedBot behaviors (duck-typing, DB writes, position upsert, incrementing trade count, position closing) and PortfolioRisk clock injection (custom date, different-date isolation)

## Task Commits

Each task was committed atomically:

1. **TDD RED: failing tests for SimulatedBot and PortfolioRisk clock** - `cd05d50` (test)
2. **Task 1: SimulatedBot implementation** - `8285a75` (feat)
3. **Task 2: PortfolioRisk clockFn injection** - `b7bcc0a` (feat)
4. **Chore: comment fix for grep verification** - `f064701` (chore)

_Note: TDD tasks have RED commit (failing tests) followed by GREEN commit (implementation)_

## Files Created/Modified

- `src/worker/core/simulation/sim-bot.ts` - SimulatedBot class: public config, recordTrade(), upsertPosition(), getStatus(), _tradeCount getter; imports BunSQLiteDatabase directly from drizzle-orm/bun-sqlite
- `src/worker/core/risk/portfolio.ts` - Added private clockFn field, optional third constructor param, updated isDailyLossBreached to use this.clockFn().split("T")[0]
- `test/core/sim-bot.test.ts` - 13 tests: 9 for SimulatedBot (Tests 1-8 from plan + _tradeCount getter), 4 for PortfolioRisk clock injection

## Decisions Made

- SimulatedBot imports `BunSQLiteDatabase` type from `drizzle-orm/bun-sqlite` rather than `TestDb` from `test/helpers/db.ts` to keep `src/` clean from `test/` imports
- clockFn defaults to `() => new Date().toISOString()` preserving exact backward compatibility — all 8 strategy files that call `new PortfolioRisk(db, getLimitsForBot(...))` remain unchanged
- All drizzle operations in SimulatedBot use synchronous `.all()` and `.run()` per established Phase 02 bun-sqlite decision; public `async` signature maintained to match BaseBotDO expectations

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Minor: sim-bot.ts JSDoc comment originally contained "cloudflare:workers" string (in "does NOT import from cloudflare:workers"), causing `grep -c "cloudflare:workers"` verification to return 1 instead of 0. Resolved by rewriting comment to not contain the literal string.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SimulatedBot is ready to be instantiated by the backtest engine (04-02)
- PortfolioRisk clock injection enables `new PortfolioRisk(db, limits, () => simulatedNow)` pattern in backtest loops
- All 101 existing tests continue to pass (no regression)
- No blockers for 04-02

## Self-Check: PASSED

- FOUND: src/worker/core/simulation/sim-bot.ts
- FOUND: src/worker/core/risk/portfolio.ts
- FOUND: test/core/sim-bot.test.ts
- FOUND: commit cd05d50 (test)
- FOUND: commit 8285a75 (feat SimulatedBot)
- FOUND: commit b7bcc0a (feat clockFn)

---
*Phase: 04-backtest-engine*
*Completed: 2026-03-22*
