# Roadmap: Trade Bot Simulation & Testing

## Overview

This milestone adds a simulation, backtesting, and paper trading layer on top of the existing Cloudflare Workers trading bot platform. Starting from test infrastructure and building up through market data generation, exchange mocking, the backtest engine, a seeder for realistic pre-populated state, reporting, and finally paper trading — each phase delivers a complete, independently verifiable capability. The entire simulation layer is additive: strategies run unchanged through their existing StrategyTickFn interface, and only a single production file (the exchange factory) receives a one-line conditional to enable simulation mode.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Test Infrastructure** - Vitest configured with in-memory SQLite, schema applied, LLM mock boundary identified
- [ ] **Phase 2: Market Data Foundation** - Deterministic market data generator producing all 5 scenario types with no-lookahead guarantee
- [ ] **Phase 3: Exchange Simulation** - SimExchangeClient implementing full ExchangeClient interface with fees, slippage, and partial fills
- [ ] **Phase 4: Backtest Engine** - Tick-by-tick engine orchestrating StrategyTickFn calls with injectable clock and isolated databases
- [ ] **Phase 5: Bot Seeder** - CLI seeder populating all 8 bot types with valid configs, market data, and trade history
- [ ] **Phase 6: Reporting and CLI** - CLI performance report with per-strategy metrics and cross-strategy comparison table
- [ ] **Phase 7: Paper Trading** - Live-price paper trading mode using SimExchangeClient with virtual balance

## Phase Details

### Phase 1: Test Infrastructure
**Goal**: The bun:test + bun:sqlite foundation exists so every subsequent component can be unit tested as it is built
**Depends on**: Nothing (first phase)
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Running `bun run test` executes at least one passing test using in-memory SQLite (not the real D1)
  2. All existing Drizzle schema tables are present in the in-memory SQLite after setup, matching production column names and types
  3. At least one unit test per strategy exercises a full tick cycle and passes without calling any real exchange or LLM API
  4. All LLM client injection points in llm-assessor and deep-research strategies are identified and a MockLLMClient stub exists
**Plans:** 2 plans
Plans:
- [ ] 01-01-PLAN.md — Test helpers (createTestDb, mocks) and schema verification
- [ ] 01-02-PLAN.md — Strategy tick tests for all 8 bot types

### Phase 2: Market Data Foundation
**Goal**: A deterministic market data generator produces all five scenario types in schemas compatible with existing Drizzle tables, with a cursor-based feed that enforces no-lookahead access
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07
**Success Criteria** (what must be TRUE):
  1. Running the generator with the same seed integer produces identical price arrays on every invocation
  2. The generator produces distinct, visually plausible price trajectories for all five scenarios: bull (rising), bear (falling), flat (sideways), volatile (high-amplitude oscillation), crash (sharp reversal)
  3. All generated market and price rows insert into the Drizzle schema without validation errors
  4. A test seeding future prices into the feed asserts that the cursor cannot return any row with a timestamp beyond the current simulated time
**Plans**: TBD

### Phase 3: Exchange Simulation
**Goal**: SimExchangeClient fully implements the ExchangeClient interface with accurate fee schedules, bid-ask slippage, configurable partial fills, and a factory extension enabling simulation mode with a single environment flag
**Depends on**: Phase 2
**Requirements**: EXCH-01, EXCH-02, EXCH-03, EXCH-04, EXCH-05, EXCH-06, EXCH-07
**Success Criteria** (what must be TRUE):
  1. Swapping SimExchangeClient for the real exchange client requires changing only one line in the existing factory (passing env._simulationFeed)
  2. A test placing a taker order on the Polymarket sim client shows 2% less proceeds than fill price; a Kalshi order shows the 1.75 cents/contract cap applied correctly
  3. A cross-arb scenario test at a configured 30% leg-2-failure rate produces roughly 30% of orders with partial fills over a large sample
  4. A sim client initialized with a 1000-unit virtual balance cannot fill orders that would exceed that balance
  5. All order and position data returned by SimExchangeClient matches the TypeScript types defined by the ExchangeClient interface (no runtime type errors)
**Plans**: TBD

### Phase 4: Backtest Engine
**Goal**: The backtest engine drives StrategyTickFn calls in time order through all five scenario types with an injectable clock, isolated per-run databases, and equity curve logging — producing trustworthy results free of lookahead bias and wall-clock contamination
**Depends on**: Phase 3
**Requirements**: BT-01, BT-02, BT-03, BT-04, BT-05, BT-06, BT-07
**Success Criteria** (what must be TRUE):
  1. Running a backtest produces equity curve snapshots timestamped at each tick interval showing balance changes over simulated time
  2. Running two backtests of the same strategy in the same process results in completely independent trade records (no rows shared between databases)
  3. A multi-day backtest where a strategy triggers the daily loss circuit breaker on day 1 resumes trading on simulated day 2 without manual intervention
  4. The llm-assessor and deep-research strategies complete a full backtest run without making any real LLM API calls and produce at least one trade record
  5. All 8 strategies complete at least one full tick cycle in the backtest engine without throwing an uncaught error
**Plans**: TBD

### Phase 5: Bot Seeder
**Goal**: A callable seeder creates valid bot instances for all 8 strategy types with matching market data and pre-populated trade history, rejecting any invalid config before insertion
**Depends on**: Phase 4
**Requirements**: SEED-01, SEED-02, SEED-03, SEED-04, SEED-05
**Success Criteria** (what must be TRUE):
  1. Running `bun run seed` from the project root populates a local D1 database with bot_instances rows for all 8 strategy types
  2. Each seeded bot has matching market and price rows that the strategy can read during a subsequent backtest run
  3. Each seeded bot has at least 10 pre-existing trade rows and matching position rows for analytics testing
  4. Passing a deliberately malformed config (missing required field) to the seeder exits with a descriptive validation error and inserts nothing
  5. The seeder function can also be imported and called programmatically from a test file
**Plans**: TBD

### Phase 6: Reporting and CLI
**Goal**: A single CLI command runs after a backtest and produces a formatted performance report with per-strategy metrics and a cross-strategy scenario comparison table
**Depends on**: Phase 4
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, RPT-07, RPT-08, RPT-09, RPT-10
**Success Criteria** (what must be TRUE):
  1. Running `bun run report` after a completed backtest prints PnL, Sharpe ratio, Sortino ratio, max drawdown, win rate, and profit factor for each strategy across each scenario
  2. The report includes a comparison table with all 8 strategies as rows and all 5 scenarios as columns so relative performance is visible at a glance
  3. The scenario heatmap colors cells by Sharpe ratio so the best and worst strategy-scenario combinations are immediately identifiable in a terminal
  4. The report shows a Brier score for llm-assessor and deep-research based on their probability predictions vs simulated outcomes
  5. The entire report pipeline (backtest + report) is runnable end-to-end with a single command
**Plans**: TBD

### Phase 7: Paper Trading
**Goal**: Paper trading mode runs selected strategies against live Polymarket and Kalshi price feeds using a simulated balance, persisting results to D1 for review
**Depends on**: Phase 3
**Requirements**: PAPER-01, PAPER-02, PAPER-03
**Success Criteria** (what must be TRUE):
  1. Starting paper trading for a strategy subscribes to live market price feeds and executes simulated orders without touching real exchange balances
  2. Paper trading uses the same SimExchangeClient as the backtest engine — no separate mock implementation exists
  3. After a paper trading session ends, trade and position records are readable from the existing React dashboard without any schema changes
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 (Phase 7 depends on Phase 3, can run in parallel with Phases 4-6 after Phase 3 completes)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Test Infrastructure | 0/2 | Planning complete | - |
| 2. Market Data Foundation | 0/? | Not started | - |
| 3. Exchange Simulation | 0/? | Not started | - |
| 4. Backtest Engine | 0/? | Not started | - |
| 5. Bot Seeder | 0/? | Not started | - |
| 6. Reporting and CLI | 0/? | Not started | - |
| 7. Paper Trading | 0/? | Not started | - |
