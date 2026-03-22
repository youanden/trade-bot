---
phase: 02-market-data-foundation
plan: "01"
subsystem: testing
tags: [simulation, prng, market-data, logit, box-muller, drizzle, bun-test]

# Dependency graph
requires:
  - phase: 01-test-infrastructure
    provides: createTestDb helper, in-memory SQLite with Drizzle, bun:test setup
provides:
  - Seeded mulberry32 PRNG factory (createPrng) for deterministic simulation
  - generateScenario() producing 5 scenario types (bull, bear, flat, volatile, crash)
  - ScenarioType, GeneratorParams, GeneratedScenario type definitions
  - Schema-compatible market and price row generation (Drizzle $inferInsert types)
  - 12 tests covering DATA-01 through DATA-07 requirements
affects:
  - 02-02 (price feed cursor consuming GeneratedScenario)
  - phase-03 (exchange simulation using generateScenario output)
  - phase-04 (backtest engine replaying generated market data)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Logit-space random walk for (0,1)-bounded probability price series"
    - "Box-Muller transform for normal sampling from mulberry32 PRNG"
    - "Crash scenario: positive drift pre-crash, large negative logit shock at crashTick+1 to preserve pre-crash high in prices[crashTick]"
    - "Drizzle bun-sqlite adapter is synchronous — use .all() and .run() not await"

key-files:
  created:
    - src/worker/core/simulation/types.ts
    - src/worker/core/simulation/prng.ts
    - src/worker/core/simulation/generator.ts
    - test/core/generator.test.ts
  modified: []

key-decisions:
  - "Crash shock applied at i === crashTick+1 (not crashTick) so prices[crashTick] holds the pre-crash high for test assertion DATA-05"
  - "Crash shock set to -5.0 logit units to ensure recovery (drift +0.03 * 79 ticks = 2.37) cannot surpass pre-crash price"
  - "Drizzle bun-sqlite is synchronous — used .all() and .run() in tests, not await/resolves.toBeDefined()"

patterns-established:
  - "Simulation module under src/worker/core/simulation/ — consistent with core/ structure"
  - "generateScenario omits id from both market and price rows; caller inserts market first, captures id, then inserts prices with that id"
  - "All price timestamps use new Date(ms).toISOString() — never SQLite datetime('now') default — ensures ISO-8601 T-format for lexicographic sort compatibility"

requirements-completed: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 02 Plan 01: Market Data Foundation — Types, PRNG, and Generator Summary

**Seeded mulberry32 PRNG with logit-space random walk generating 5 scenario types (bull, bear, flat, volatile, crash) producing Drizzle-schema-compatible market and price rows**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T00:48:50Z
- **Completed:** 2026-03-22T00:51:50Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Implemented mulberry32 seeded PRNG factory (`createPrng`) — pure TypeScript, no Node.js/crypto dependencies, Cloudflare Workers compatible
- Implemented `generateScenario()` with logit-space random walk and Box-Muller normal sampling for 5 distinct scenario types
- Generated rows are fully compatible with Drizzle `$inferInsert` types — insert without FK or type errors
- 12 tests covering all DATA-01 through DATA-07 requirements, full suite 56 tests pass with no regressions

## Task Commits

1. **Task 1: Types, PRNG, and generator with TDD tests** - `c4cc1db` (feat)

## Files Created/Modified

- `src/worker/core/simulation/types.ts` — ScenarioType, GeneratorParams, GeneratedScenario, MarketInsert, PriceInsert type definitions
- `src/worker/core/simulation/prng.ts` — mulberry32 seeded PRNG factory (`createPrng`)
- `src/worker/core/simulation/generator.ts` — `generateScenario()` with logit/sigmoid helpers, Box-Muller sampling, scenario parameter table
- `test/core/generator.test.ts` — 12 tests covering DATA-01 through DATA-07, price bounds, timestamp format, market row fields

## Decisions Made

- **Crash shock position**: Applied at loop index `i === crashTick + 1` (not `crashTick`) so that `prices[crashTick]` holds the pre-crash high. The test DATA-05 asserts `prices[floor(0.6*ticks)] > prices[last]` which requires the crash tick index to be the peak, not the first post-shock value.
- **Crash shock magnitude**: Set to -5.0 logit units. With drift +0.03/tick and ~79 remaining ticks, recovery adds 2.37 logit units — final logit remains ~2.63 below pre-crash peak, ensuring `prices[last] < prices[crashTick]` holds deterministically with seed 42.
- **Drizzle bun-sqlite is synchronous**: Used `.all()` to get insert results and `.run()` for bulk inserts — `await` and `resolves.toBeDefined()` patterns are async and fail with the bun-sqlite adapter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Crash shock placement caused prices[crashTick] to show post-shock value**
- **Found during:** Task 1 (GREEN phase — test DATA-05 failing)
- **Issue:** Plan spec said `crashTick=Math.floor(ticks*0.6)` but applying shock when `i === crashTick` meant `prices[crashTick]` was the ALREADY-shocked low (0.28), while the test asserts `prices[crashTick]` should be the PRE-crash high
- **Fix:** Changed shock condition to `i === crashTick + 1` so the shock builds the tick-121 price, preserving tick-120 as the pre-crash high
- **Files modified:** `src/worker/core/simulation/generator.ts`
- **Verification:** `bun test test/core/generator.test.ts` passes DATA-05
- **Committed in:** c4cc1db (Task 1 commit)

**2. [Rule 1 - Bug] Crash scenario recovered too strongly to pass DATA-05**
- **Found during:** Task 1 (after shock placement fix, last price still exceeded crashTick price)
- **Issue:** Plan specified crashShock=-2.5, but with drift=+0.03 and ~79 remaining ticks, net recovery exceeds the shock (0.03*79=2.37 vs. 2.5 shock = only 0.13 logit depression), so final price approached pre-crash level
- **Fix:** Increased crashShock from -2.5 to -5.0 logit units ensuring net permanent depression of ~2.63 logit units
- **Files modified:** `src/worker/core/simulation/generator.ts`
- **Verification:** prices[120]=0.955 > prices[199]=0.805 with seed 42, 200 ticks
- **Committed in:** c4cc1db (Task 1 commit)

**3. [Rule 1 - Bug] Schema conformance test used async pattern on synchronous Drizzle adapter**
- **Found during:** Task 1 (GREEN phase — DATA-06 test failing with "Expected promise" error)
- **Issue:** Test used `await db.insert().values().returning()` and `resolves.toBeDefined()` but drizzle-orm/bun-sqlite is synchronous — insert() returns a builder, not a Promise
- **Fix:** Changed to `.all()` for returning insert and `.run()` for bulk insert
- **Files modified:** `test/core/generator.test.ts`
- **Verification:** Both DATA-06 tests pass
- **Committed in:** c4cc1db (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bugs)
**Impact on plan:** All three fixes required for correctness. No scope creep. Shock magnitude deviation from plan spec (-5.0 vs -2.5) is mathematically necessary given the drift parameters.

## Issues Encountered

- The plan spec combination of `drift=+0.03, sigma=0.08, crashShock=-2.5` with 200 ticks and ~79 post-crash ticks creates a near-neutral net effect — the price almost fully recovers. Increased shock to -5.0 to ensure the statistical property holds deterministically (not just probabilistically).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `generateScenario()` is the complete output for this plan — ready for Phase 02-02 (PriceFeed cursor)
- `src/worker/core/simulation/` directory established, Phase 03 can add `feed.ts` and Phase 04 can add backtest engine files
- No blockers for Phase 02-02

---
*Phase: 02-market-data-foundation*
*Completed: 2026-03-22*
