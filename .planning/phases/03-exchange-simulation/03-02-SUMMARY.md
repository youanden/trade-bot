---
phase: 03-exchange-simulation
plan: 02
subsystem: testing
tags: [simulation, exchange-client, factory, typescript]

# Dependency graph
requires:
  - phase: 03-01
    provides: SimExchangeClient class and PriceFeed from src/worker/core/simulation/

provides:
  - Extended createExchangeClient factory with optional simFeed parameter
  - EXCH-07 test verifying factory returns SimExchangeClient when simFeed provided
  - Zero-change backward compatibility — existing callers unaffected

affects: [04-backtest-engine, 07-paper-trading]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional simFeed parameter pattern: factory returns sim or real client at call site — strategies call unchanged"

key-files:
  created: []
  modified:
    - src/worker/core/exchanges/factory.ts
    - test/core/sim-client.test.ts

key-decisions:
  - "simFeed spread order: platform + feed set first, then config spread last so caller overrides take priority"

patterns-established:
  - "Factory extension pattern: add optional simFeed param as third arg — existing two-arg callers unaffected, Phase 4 backtest engine passes third arg to inject simulation"

requirements-completed: [EXCH-07]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 3 Plan 02: Factory Extension for Simulation Mode Summary

**createExchangeClient extended with optional simFeed parameter — returns SimExchangeClient when provided, real client otherwise, with EXCH-07 test coverage**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-22T01:41:15Z
- **Completed:** 2026-03-22T01:43:03Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Extended `createExchangeClient` with optional `simFeed` parameter (single optional arg, zero existing-caller changes)
- `simFeed` branch returns `new SimExchangeClient(...)` with sane defaults (`virtualBalance: 1000`, `simulatedNow: () => new Date().toISOString()`)
- Added EXCH-07 describe block with two tests: SimExchangeClient instance check and existing credential-throw behavior
- All 88 tests pass (26 in sim-client.test.ts, 62 across other strategy tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend factory with simulation mode and add EXCH-07 test** - `4a06645` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/worker/core/exchanges/factory.ts` - Added simFeed optional param, SimExchangeClient branch, PriceFeed/SimExchangeClient imports
- `test/core/sim-client.test.ts` - Added createExchangeClient import and EXCH-07 describe block

## Decisions Made
- Spread `simFeed.config` last in SimExchangeClient constructor call so any explicit caller overrides take priority over defaults

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (backtest engine) can now call `createExchangeClient(env, platform, { feed, config })` to inject a SimExchangeClient into any strategy tick without modifying strategy code
- Factory is the single switchboard — strategies remain untouched

## Self-Check: PASSED
- factory.ts: FOUND
- sim-client.test.ts: FOUND
- 03-02-SUMMARY.md: FOUND
- Commit 4a06645: FOUND

---
*Phase: 03-exchange-simulation*
*Completed: 2026-03-22*
