---
phase: 03-exchange-simulation
plan: 01
subsystem: testing
tags: [simulation, exchange, fees, backtest, kalshi, polymarket, prng, partial-fills]

# Dependency graph
requires:
  - phase: 02-market-data-foundation
    provides: PriceFeed with no-lookahead latestAt(), generateScenario() for test setup
  - phase: 01-test-infrastructure
    provides: MockExchangeClient pattern and bun test runner conventions

provides:
  - SimExchangeClient class implementing full ExchangeClient interface (11 methods)
  - SimClientConfig interface for dependency-injectable simulation configuration
  - Polymarket 2% taker / 0% maker fee model
  - Kalshi fee formula: ceil(0.07 * P * (1-P) * 10000) / 10000 per contract
  - Seeded PRNG-based partial fill and leg-2 failure modelling
  - Virtual balance tracking with insufficient-balance guard

affects:
  - 03-02 (seeder — may use SimExchangeClient for pre-populating trade history)
  - 04-backtest-engine (primary consumer — replaces real exchange clients in backtests)
  - 07-paper-trading (uses same SimExchangeClient for live paper mode)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD: RED commit (failing tests) → GREEN commit (passing implementation) → refactor if needed"
    - "Kalshi fee float guard: round to 8 decimal places before Math.ceil to prevent off-by-one from IEEE-754 noise"
    - "SimClientConfig.simulatedNow as function injection — caller advances clock, client remains stateless about time"
    - "Seeded PRNG (mulberry32) injected via createPrng(seed) — all randomness deterministic per seed"

key-files:
  created:
    - src/worker/core/simulation/sim-client.ts
    - test/core/sim-client.test.ts
  modified: []

key-decisions:
  - "Kalshi fee formula uses Math.ceil guarded by Math.round(raw * 1e8) / 1e8 to prevent IEEE-754 noise from rounding exact integers up (e.g. 0.07 * 0.5 * 0.5 * 10000 = 175.0000000000003)"
  - "Fill price taken from PriceFeed.latestAt(simulatedNow) not from order.price — enforces no-lookahead in fill calculations"
  - "Fee tests use scenario.prices[0].timestamp (startPrice=0.5 exactly) to avoid floating-point variance in assertions"
  - "leg2FailRate PRNG roll occurs before partialFillRate roll — models independent failure modes"

patterns-established:
  - "Fee test pattern: use tick-0 timestamp where price equals exact startPrice for deterministic fee math"
  - "Partial fill size: 50% to 99% of requested size via 0.5 + rng() * 0.49"

requirements-completed: [EXCH-01, EXCH-02, EXCH-03, EXCH-04, EXCH-05, EXCH-06]

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 03 Plan 01: SimExchangeClient Summary

**Fee-aware simulated exchange client implementing full ExchangeClient interface with Polymarket taker fees, Kalshi per-contract fee formula, seeded partial fills, and virtual balance enforcement**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-22T01:37:00Z
- **Completed:** 2026-03-22T01:41:00Z
- **Tasks:** 1 (TDD: RED + GREEN phases)
- **Files modified:** 2

## Accomplishments

- SimExchangeClient fully implements all 11 ExchangeClient methods (getMarkets, getMarket, getPrice, getOrderBook, placeOrder, cancelOrder, getOrder, getOpenOrders, getPositions, getBalance)
- Polymarket fee model: taker pays 2% of notional, maker pays 0% — enforced via postOnly flag
- Kalshi fee formula: `ceil(0.07 * P * (1-P) * 10000) / 10000` per contract with IEEE-754 float guard
- Deterministic partial fill simulation (30% rate → 20-40% partials over 200 samples confirmed)
- Virtual balance deduction with insufficient-balance guard returning status "failed"
- 24 tests cover EXCH-01 through EXCH-06, full suite 86/86 green

## Task Commits

1. **RED — Test file** - `cab30e0` (test: failing tests for EXCH-01..EXCH-06)
2. **GREEN — Implementation** - `8263bf7` (feat: SimExchangeClient with fees, partial fills, virtual balance)

**Plan metadata:** (forthcoming — docs commit)

_Note: TDD task has two commits (test → feat); no refactor needed as fee methods already extracted_

## Files Created/Modified

- `src/worker/core/simulation/sim-client.ts` - SimExchangeClient class and SimClientConfig interface; implements ExchangeClient; 270 lines
- `test/core/sim-client.test.ts` - Comprehensive tests for EXCH-01 through EXCH-06; 24 tests; 360 lines

## Decisions Made

- **Kalshi fee float guard:** `Math.ceil(Math.round(raw * 1e8) / 1e8) / 10000` — without the round, `0.07 * 0.5 * 0.5 * 10000 = 175.0000000000003` causes ceil to return 176 instead of 175, producing 1.76 cents/contract instead of the expected 1.75 cents.
- **Fill price from PriceFeed not order.price:** Enforces no-lookahead. Tests use `scenario.prices[0].timestamp` (exact startPrice=0.5) so fee calculations are deterministic.
- **leg2FailRate rolled before partialFillRate:** Logically distinct failure modes (leg-2 failure = order never reaches exchange; partial fill = order reaches exchange but is partially matched).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kalshi fee floating point guard**
- **Found during:** Task 1 (GREEN phase — fee tests failing)
- **Issue:** `Math.ceil(0.07 * 0.5 * 0.5 * 10000)` returns 176 not 175 due to IEEE-754 representation noise
- **Fix:** Added `Math.round(raw * 1e8) / 1e8` before `Math.ceil` to normalize exact-integer values
- **Files modified:** `src/worker/core/simulation/sim-client.ts`
- **Verification:** `bun test test/core/sim-client.test.ts` — all 24 pass
- **Committed in:** `8263bf7` (GREEN commit)

**2. [Rule 1 - Bug] Fee test assertions assumed order.price not feed price**
- **Found during:** Task 1 (GREEN phase — EXCH-03/04/06 tests failing)
- **Issue:** Test setup used `simulatedNow: () => scenario.prices[5].timestamp` — feed price at tick 5 is ~0.453, not 0.5, so fee expectations were off
- **Fix:** Updated fee tests to use `simulatedNow: () => scenario.prices[0].timestamp` where yesPrice equals exactly startPrice=0.5
- **Files modified:** `test/core/sim-client.test.ts`
- **Verification:** All 24 tests pass with correct balance assertions
- **Committed in:** `8263bf7` (GREEN commit, test file updated in same commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes required for test correctness. No scope creep — implementation meets all plan spec requirements.

## Issues Encountered

- None beyond the two auto-fixed bugs above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SimExchangeClient ready for use by Phase 4 backtest engine as drop-in ExchangeClient replacement
- SimClientConfig.simulatedNow callable allows clock advancement from backtest runner
- Seeded PRNG ensures reproducible backtest runs given same seed
- Fee model validated against plan spec for both Polymarket and Kalshi
