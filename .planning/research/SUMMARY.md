# Project Research Summary

**Project:** trade-bot — simulation, backtesting, and seeder milestone
**Domain:** Prediction market trading bot simulation layer (Polymarket + Kalshi)
**Researched:** 2026-03-21
**Confidence:** HIGH (architecture and stack); MEDIUM (prediction-market-specific feature nuances)

## Executive Summary

This milestone adds a simulation, backtesting, and seeding layer to an existing production trading bot that operates on Polymarket and Kalshi. The existing codebase is well-structured for this: strategies are already expressed as `StrategyTickFn = (bot: BaseBotDO, env: Env) => Promise<void>`, and `ExchangeClient` is an interface explicitly designed to support swapping. The correct pattern is interface substitution — a `SimulatedExchangeClient` is injected in place of the real exchange client via a single one-line extension to the existing `createExchangeClient` factory. Strategies run unchanged, exercising their exact production code paths. No backtesting library exists that fits this architecture; the engine is approximately 200 lines of custom TypeScript.

The recommended approach is an event-driven, tick-by-tick backtest engine driven by a seeded-PRNG market data generator producing the five required scenario types (bull, bear, flat, volatile, crash). The test infrastructure switches from `bun test` to Vitest 4.x with `@cloudflare/vitest-pool-workers` — the only official path to test Durable Objects and D1 bindings in the actual workerd runtime. In-memory SQLite via `bun:sqlite` (built-in, no install) backs unit tests; Wrangler's local D1 backs integration tests. The seeder, backtest CLI, and reporting scripts run directly with `bun run` against TypeScript files — no additional execution layer needed.

The primary risk category is result validity: lookahead bias (strategies seeing future prices via unguarded DB reads), overstated PnL (fills at signal price with no slippage model), and clock contamination (wall time bleeding into simulated daily circuit-breaker resets). All three must be designed into the backtest engine from the start; retrofitting any of them after results are produced requires discarding all prior output and re-running. A secondary risk is that `llm-assessor` and `deep-research` strategies have a second mock boundary (LLM clients) that is distinct from the exchange client — missing this causes those strategies to silently produce zero trades or incur real API costs during backtest.

## Key Findings

### Recommended Stack

The project extends its existing Bun + Drizzle + Cloudflare Workers stack with minimal new dependencies. The most significant change is switching the test runner from `bun test` to Vitest 4.x, which is required by `@cloudflare/vitest-pool-workers` — the only official mechanism for testing Durable Objects and `applyD1Migrations()`. This is low-friction because the project has no existing test suite to migrate. All CLI scripts run via `bun run` against native TypeScript files.

**Core technologies:**
- `vitest ^4.1.0` + `@cloudflare/vitest-pool-workers ^0.13.3`: integration test runner inside actual workerd runtime — only official path for DO and D1 testing
- `bun:sqlite` (built-in): in-memory SQLite for unit tests — faster than alternatives, no install, no ABI issues
- `drizzle-orm/bun-sqlite`: Drizzle adapter for bun:sqlite — same schema and query API as production D1
- `seedrandom ^3.0.5`: seeded PRNG for deterministic scenario generation — reproducible backtests from a seed integer
- `cli-table3 ^0.6.5`: formatted terminal output for performance comparison tables
- Custom backtest engine (~200 lines): no external backtesting library fits the `StrategyTickFn` interface or prediction market probability data model

See `.planning/research/STACK.md` for full alternatives analysis and dependency delta.

### Expected Features

**Must have (table stakes):**
- Market data seeder — generates markets, prices, bot_instances rows for all 8 bot types across 5 scenario types; must be compatible with existing Drizzle schema
- SimExchangeClient (exchange mock) — implements full `ExchangeClient` interface; enforces look-ahead bias guard and fee simulation at fill time
- Backtest engine (replay loop) — event-driven tick-by-tick; calls actual `StrategyTickFn`; persists results to in-memory SQLite
- Per-strategy metrics report — PnL, Sharpe ratio, max drawdown, win rate, profit factor from trade records
- Strategy comparison CLI table — cross-strategy, cross-scenario view; best/worst strategy per scenario
- Vitest unit tests — cover each strategy's tick function with mock exchange and in-memory SQLite
- Wrangler integration tests — end-to-end tick execution against local D1

**Should have (competitive):**
- Real market data capture and replay — historical data from Polymarket/Kalshi APIs via existing exchange clients; no third-party data service
- Equity curve logging — timestamped balance snapshots during replay; shows when drawdowns occur
- Sortino ratio — downside-volatility-only risk metric; more appropriate than Sharpe for binary-outcome markets
- Paper trading mode — live price feeds through sim exchange with virtual balance

**Defer (v2+):**
- Probability calibration / Brier score — meaningful only for llm-assessor and deep-research; requires resolved outcome data
- Dashboard UI — explicitly deferred in PROJECT.md; CLI is sufficient for dev-time tooling
- Arb spread scenario generation — requires synchronized cross-platform price feeds; out of scope for this milestone
- Monte Carlo resampling — sample sizes per strategy are too small to produce valid distributions; scenario diversity achieves regime coverage instead

See `.planning/research/FEATURES.md` for full prioritization matrix and competitor analysis.

### Architecture Approach

The simulation layer lives entirely in `src/simulation/` as a sibling to `src/worker/`, with zero imports in the reverse direction. Four execution contexts share the same strategy code: production (real clients), backtest CLI (simulated clients + in-memory SQLite), paper trading CLI (real prices, simulated fills), and seeder CLI (data generation only). The single production file modified is `src/worker/core/exchanges/factory.ts`, which receives a one-line check: if `env._simulationFeed` is present, return a `SimulatedExchangeClient` instead of the real client. This enables the entire simulation layer without touching any strategy code.

**Major components:**
1. `MarketDataGenerator` + `MarketDataFeed` — produces deterministic price tick arrays per scenario; cursor-based feed enforces no-lookahead constraint
2. `SimulatedExchangeClient` — full `ExchangeClient` implementation; models bid-ask spread and fee schedules; simulates partial fills for cross-arb
3. `SimulatedBot` — plain TypeScript class (not a Durable Object) backed by in-memory Drizzle/bun:sqlite; satisfies the duck-typed interface strategies use via `(bot as any).config` and `(bot as any).recordTrade()`
4. `BacktestEngine` — tick-by-tick orchestrator; advances `BacktestClock`; calls `StrategyTickFn`; one fresh DB per strategy-scenario pair
5. `ReportGenerator` — reads trades/positions from simulation DB; computes metrics using existing `core/risk/analytics` functions; formats CLI tables via cli-table3
6. Seeder CLI — `BotConfigFactory` + `MarketSeeder` + `TradeHistorySeeder`; populates a target DB for dashboard inspection or integration test setup

See `.planning/research/ARCHITECTURE.md` for full component map, data flow diagrams, and build order.

### Critical Pitfalls

1. **Lookahead bias via unguarded DB reads** — Strategies that query the `prices` table without a `WHERE created_at <= simTime` filter silently see future data; backtest Sharpe ratios above 3.0 and win rates above 70% across all scenarios are the signal. Prevention: build a temporal filter into the `MarketDataFeed` cursor before any strategy runs; write a test that seeds future data and asserts the strategy cannot see it.

2. **Fills at signal price with no slippage model** — The simplest mock sets `filledPrice = order.price`, inflating every strategy's returns; paper trading divergence becomes inexplicable. Prevention: model bid-ask spread and apply a slippage penalty at fill time from day one; make it a configurable scenario parameter, not a constant.

3. **Wall clock in strategy circuit breakers** — `PortfolioRisk.isDailyLossBreached()` calls `new Date()` internally; a multi-day backtest compressed to seconds never resets the circuit breaker. Prevention: inject an optional `now: () => Date` into `PortfolioRisk`; the backtest engine passes a controlled clock returning `simTime`.

4. **LLM strategies not stubbed** — `llm-assessor` and `deep-research` have a second external dependency (LLM API) beyond the exchange client; without a `MockLLMClient` they either make real API calls or produce zero trades. Prevention: audit all external dependencies before building any mock layer; create a `MockLLMClient` returning deterministic fixed assessments.

5. **Seeder producing invalid strategy configs** — Configs are cast unsafely `(bot as any).config as CrossArbConfig`; missing fields produce `NaN` trade sizes that pass risk checks silently. Prevention: validate every seeded bot config against a Zod schema for its strategy type before insertion; assert at least one trade per bot per scenario after backtest.

See `.planning/research/PITFALLS.md` for full pitfall details, warning signs, and recovery strategies.

## Implications for Roadmap

The architecture research provides an explicit build order based on dependency analysis. Phase structure follows directly from it, with pitfall prevention mapped to the earliest possible phase.

### Phase 1: Dependency Audit and Test Infrastructure
**Rationale:** The LLM-strategy mocking gap must be identified before anything else is built; discovering it after the seeder and engine are complete forces a backtrack. Test infrastructure (Vitest + bun:sqlite setup) must exist before any component can be verified.
**Delivers:** Vitest 4.x configured with `@cloudflare/vitest-pool-workers`; in-memory SQLite schema setup; `MockLLMClient` stub; confirmed list of all mock boundaries (exchange + LLM + any others).
**Addresses:** Table-stakes feature "Vitest unit tests"; pitfall "LLM strategies not stubbed"
**Avoids:** Discovering the LLM mock gap during engine integration (high-cost fix); bun:test → Vitest migration friction later

### Phase 2: Foundation (Clock, Feed, Generator)
**Rationale:** `BacktestClock`, `MarketDataFeed`, and `MarketDataGenerator` have no dependencies on other simulation components and are prerequisites for everything that follows. Temporal correctness must be established here.
**Delivers:** Deterministic scenario data for all 5 scenario types; cursor-based feed with no-lookahead guarantee; controlled clock for circuit-breaker testing.
**Uses:** `seedrandom` for reproducibility; existing `prices` table schema
**Implements:** Architecture components `BacktestClock`, `MarketDataFeed`, `MarketDataGenerator`
**Avoids:** Lookahead bias pitfall (designed into feed from day one); wall-clock contamination pitfall (clock injectable from day one)

### Phase 3: Exchange Mock and Factory Extension
**Rationale:** `SimulatedExchangeClient` is the central integration seam; all strategy testing depends on it. The single-line factory extension is the only production file change and should be isolated to a known, reviewable diff.
**Delivers:** Full `ExchangeClient` implementation with bid-ask spread, fee schedules (Kalshi 1.75¢/contract max, Polymarket 0%/2%), configurable partial-fill rate for cross-arb scenarios; factory check enabling simulation mode via `env._simulationFeed`.
**Addresses:** Table-stakes "SimExchangeClient" and "Look-ahead bias guard" and "Fee simulation"; pitfall "Fills at signal price"
**Avoids:** Slippage-free mock shipping as a shortcut; cross-arb partial fill never simulated

### Phase 4: SimulatedBot and Engine
**Rationale:** `SimulatedBot` requires extracting `recordTrade` from `BaseBotDO` as a shared utility first (minimal refactor, one file). `BacktestEngine` then wires all Phase 1-3 components and runs the tick loop with an isolated DB per strategy-scenario pair.
**Delivers:** Working end-to-end backtest for at least one strategy; fresh in-memory SQLite per run preventing state leakage; injected clock tested against circuit-breaker reset across simulated days.
**Implements:** Architecture components `SimulatedBot`, `BacktestEngine`
**Avoids:** Shared DB state across simulations; DurableObject instantiation in tests; wall-clock circuit-breaker failure

### Phase 5: Seeder
**Rationale:** Seeder depends on `BotConfigFactory` (needs all 8 strategy config types correct), `MarketSeeder` (needs `MarketDataGenerator`), and `TradeHistorySeeder` (needs `SimulatedBot.recordTrade`). Running it after the engine means it can be validated by re-running backtests against seeded data.
**Delivers:** CLI command to populate a local D1 or in-memory DB with realistic markets, prices, bot configs, and historical trades for all 8 bot types across 5 scenarios; Zod config validation for all strategy types.
**Addresses:** Table-stakes "Market data seeder"; pitfall "Seeder producing invalid strategy configs"
**Avoids:** `sim_`-prefixed market IDs to prevent collision with real platform IDs; production D1 contamination

### Phase 6: Reporting and CLI
**Rationale:** `ReportGenerator` reads from the simulation DB using existing `core/risk/analytics` functions (Sharpe, drawdown already implemented). CLI runner is the last integration point that wires everything and provides the user-facing output.
**Delivers:** Per-strategy metrics (PnL, Sharpe, max drawdown, win rate, profit factor); cross-strategy comparison table; scenario heatmap; `cli-table3` formatted output.
**Uses:** `cli-table3`; existing `src/worker/core/risk/analytics` functions
**Implements:** `ReportGenerator`, `CLI runner`

### Phase 7: Integration Tests
**Rationale:** Integration tests against Wrangler local D1 validate the full tick loop including DO alarm behavior. They run last because they require all components to be in place and are slower (Wrangler startup ~2-3s); keep count small (smoke tests only).
**Delivers:** End-to-end test confirming mock exchange wires through DO alarm path; `applyD1Migrations()` used to seed schema; schema drift detection between in-memory and local D1.
**Addresses:** Table-stakes "Wrangler dev integration tests"

### Phase 8: Real Data Capture and Paper Trading (v1.x)
**Rationale:** Add after the core backtest loop is producing trustworthy results with generated data. Real data capture uses existing Polymarket CLOB `/prices-history` and Kalshi REST endpoints through the existing exchange clients — no new libraries.
**Delivers:** Historical data snapshots for replay; paper trading mode with live prices and simulated fills; equity curve logging; Sortino ratio.
**Addresses:** Features "Real market data capture", "Paper trading mode", "Equity curve logging", "Sortino ratio"

### Phase Ordering Rationale

- Dependency audit precedes all implementation because the LLM mock gap is non-obvious and expensive to discover late.
- Foundation components (clock, feed, generator) have no upstream dependencies and enable test coverage of everything built afterward.
- The factory extension (one production file change) is isolated to Phase 3 so the diff is reviewable in isolation.
- The seeder runs after the engine so it can be immediately validated by running a backtest against seeded data.
- Integration tests run last to keep CI fast; unit tests with in-memory SQLite run throughout.
- Real data and paper trading are explicitly v1.x because they add complexity without blocking the primary goal of evaluating strategy behavior across scenarios.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Exchange Mock):** Kalshi and Polymarket fee schedule details and order book depth characteristics need verification against current API documentation before encoding into the mock. The Polymarket CLOB specifically has maker/taker asymmetry that affects market-maker strategy evaluation.
- **Phase 4 (Engine/SimulatedBot):** The exact interface strategies use to access `BaseBotDO` (via `(bot as any).config` and `(bot as any).recordTrade()`) must be verified against current source before writing `SimulatedBot`. Any refactor risk to `BaseBotDO` during this milestone should be scoped first.
- **Phase 7 (Integration Tests):** `runInDurableObject()` from `@cloudflare/vitest-pool-workers` behavior and `applyD1Migrations()` usage should be verified against the 0.13.3 release notes before the integration test phase begins.

Phases with standard patterns (skip deep research-phase):
- **Phase 1 (Test Infrastructure):** Vitest + `@cloudflare/vitest-pool-workers` setup is well-documented by Cloudflare; follow official guide directly.
- **Phase 2 (Foundation):** Clock abstraction, cursor-based feed, and PRNG-seeded generators are standard patterns with no prediction-market-specific nuances.
- **Phase 6 (Reporting):** Metrics formulas (Sharpe, drawdown, win rate, profit factor) are unambiguous; existing `core/risk/analytics` functions already implement the hard parts.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All dependencies verified on npm registry March 2026; official Cloudflare docs confirm vitest-pool-workers approach; bun:sqlite is a first-class built-in |
| Features | MEDIUM | Table-stakes features are HIGH confidence; prediction-market-specific nuances (fee schedules, CLOB depth characteristics, Brier score applicability) are MEDIUM — specialized domain with limited tooling |
| Architecture | HIGH | Interface-substitution pattern verified against real codebase; NautilusTrader and barter-rs confirm event-driven tick-by-tick approach; component boundaries derived from existing source analysis |
| Pitfalls | HIGH (architecture-specific) / MEDIUM (general) | Lookahead bias, clock contamination, and invalid config pitfalls are identified from direct codebase inspection; slippage and partial-fill pitfalls are from multiple external sources |

**Overall confidence:** HIGH for the core approach; MEDIUM for prediction-market-specific quantitative details (fee structures, realistic spread ranges) that should be validated during Phase 3 implementation.

### Gaps to Address

- **Kalshi current fee schedule:** The 1.75¢/contract maximum fee is documented but the full taker/maker breakdown for the current API version should be re-verified at Phase 3 time; fee structures have changed in the past.
- **Polymarket CLOB order book depth characteristics:** "Realistic" bid-ask spread for the slippage model needs calibration against real order book data; the research uses a reasonable proxy (0.001–0.003 noise) but Phase 3 should validate this against a sample of real Polymarket markets.
- **`BaseBotDO` duck-typed interface stability:** Strategies access `config` and `recordTrade()` via `(bot as any)` casts. If these member names are renamed during this milestone, `SimulatedBot` will silently break. Before Phase 4, verify the exact member names in the current source and consider whether a shared interface type should be extracted.
- **LLM client factory patchability:** The research identifies that `llm-assessor` and `deep-research` have an LLM dependency that needs mocking, but the exact factory or injection point for LLM clients in the current codebase was not confirmed. Phase 1's dependency audit must resolve this.

## Sources

### Primary (HIGH confidence)
- Cloudflare Workers Vitest integration official docs — vitest-pool-workers setup, `applyD1Migrations()`, `runInDurableObject()`
- `@cloudflare/vitest-pool-workers` 0.13.3 npm registry (March 2026) — peer dependency on vitest ^4.1.0 confirmed
- Drizzle ORM official docs — `drizzle-orm/bun-sqlite` connector and bun:sqlite adapter
- Bun official docs — native bun:sqlite, TypeScript execution, bun:test vs Vitest tradeoffs
- Existing codebase analysis — `src/worker/core/exchanges/types.ts`, `src/worker/bots/base.ts`, `src/worker/bots/registry.ts`, `src/worker/core/risk/` (direct source inspection)
- Polymarket CLOB historical timeseries API docs — `GET /prices-history` endpoint confirmed
- NautilusTrader architecture — event-driven tick-by-tick execution pattern
- barter-rs architecture — interface-substitution pattern for live/backtest parity

### Secondary (MEDIUM confidence)
- evan-kolberg/prediction-market-backtesting (GitHub) — confirms chronological replay approach; fee simulation patterns for Kalshi/Polymarket
- PolySimulator — confirms Kalshi bid-ask spread characteristics cited in slippage model
- QuantStrategy.io / LuxAlgo / Interactive Brokers — backtesting metrics formulas and event-driven vs vectorised tradeoffs
- Gainium / 24markets / fxreplay — lookahead bias and curve-fitting pitfall descriptions

### Tertiary (LOW confidence)
- Kalshi 1.75¢/contract fee maximum — cited from PolySimulator notes; should be re-verified against current Kalshi API documentation before encoding into the mock exchange

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
