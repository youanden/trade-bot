# Requirements: Trade Bot Simulation & Testing

**Defined:** 2026-03-21
**Core Value:** Confidently evaluate and compare all 8 trading strategies against realistic market scenarios before risking real capital.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Test Infrastructure

- [ ] **TEST-01**: Vitest configured with in-memory SQLite for strategy unit tests
- [ ] **TEST-02**: Drizzle schema applied to in-memory SQLite matching production D1 schema
- [ ] **TEST-03**: Each of the 8 strategies has at least one unit test exercising a full tick cycle

### Market Data Generation

- [ ] **DATA-01**: Market data generator produces bull trend price series (probability 0→1 bounded, realistic trajectory)
- [ ] **DATA-02**: Market data generator produces bear trend price series
- [ ] **DATA-03**: Market data generator produces flat/sideways price series
- [ ] **DATA-04**: Market data generator produces high-volatility price series
- [ ] **DATA-05**: Market data generator produces crash scenario price series (sudden reversal)
- [ ] **DATA-06**: Generated data conforms to existing `markets` and `prices` Drizzle schema
- [ ] **DATA-07**: Generator uses seeded PRNG for reproducible scenarios across runs

### Bot Seeder

- [ ] **SEED-01**: Seeder creates valid bot_instances rows for all 8 bot types with correct typed configs
- [ ] **SEED-02**: Seeder generates matching market and price data for each bot's trading pairs
- [ ] **SEED-03**: Seeder populates pre-existing trades, positions, and orders for analytics testing
- [ ] **SEED-04**: Seeder validates all bot configs with Zod schemas before insertion (no silent NaN failures)
- [ ] **SEED-05**: Seeder is callable as a CLI command and as a programmatic API

### Exchange Simulation

- [ ] **EXCH-01**: SimExchangeClient implements the full ExchangeClient interface
- [ ] **EXCH-02**: SimExchangeClient serves prices from seeded data at current tick timestamp only (look-ahead bias guard)
- [ ] **EXCH-03**: SimExchangeClient applies Polymarket fee schedule (0% maker / 2% taker) on fills
- [ ] **EXCH-04**: SimExchangeClient applies Kalshi fee schedule (1.75¢/contract max) on fills
- [ ] **EXCH-05**: SimExchangeClient models partial fills and leg-2 failure at configurable rates for cross-arb
- [ ] **EXCH-06**: SimExchangeClient supports configurable virtual starting balance per bot
- [ ] **EXCH-07**: createExchangeClient factory extended with simulation mode (one-line production change)

### Backtest Engine

- [ ] **BT-01**: BacktestClock advances tick-by-tick at configurable intervals, replacing wall clock
- [ ] **BT-02**: Backtest engine drives StrategyTickFn calls in time order using BacktestClock
- [ ] **BT-03**: SimulatedBot duck-types BaseBotDO interface (config access, recordTrade, getStatus)
- [ ] **BT-04**: PortfolioRisk.isDailyLossBreached() uses injectable clock instead of new Date()
- [ ] **BT-05**: Each backtest run uses an isolated database (no cross-contamination between runs)
- [ ] **BT-06**: Equity curve logged as timestamped balance snapshots during replay
- [ ] **BT-07**: LLM-dependent strategies (llm-assessor, deep-research) use a mock LLM client in backtest

### Paper Trading

- [ ] **PAPER-01**: Paper trading mode consumes live market feeds with simulated balance
- [ ] **PAPER-02**: Paper trading uses the same SimExchangeClient as backtest (shared mock infrastructure)
- [ ] **PAPER-03**: Paper trading results persist to D1 for review via existing dashboard

### Reporting

- [ ] **RPT-01**: CLI report shows PnL per strategy per scenario
- [ ] **RPT-02**: CLI report shows Sharpe ratio per strategy per scenario
- [ ] **RPT-03**: CLI report shows maximum drawdown per strategy per scenario
- [ ] **RPT-04**: CLI report shows win rate per strategy per scenario
- [ ] **RPT-05**: CLI report shows profit factor per strategy per scenario
- [ ] **RPT-06**: CLI report shows Sortino ratio per strategy per scenario
- [ ] **RPT-07**: Strategy comparison table aggregates all strategies side-by-side per scenario
- [ ] **RPT-08**: Scenario heatmap shows strategy × scenario grid colored by Sharpe
- [ ] **RPT-09**: Brier score reported for llm-assessor and deep-research strategies
- [ ] **RPT-10**: CLI report is runnable as a single command after backtest completes

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Real Data

- **REAL-01**: Capture historical price data from Polymarket CLOB API
- **REAL-02**: Capture historical trade data from Kalshi REST API
- **REAL-03**: Store captured data as replayable snapshots
- **REAL-04**: Replay captured data through SimExchangeClient

### Integration Tests

- **INTG-01**: Wrangler dev integration tests with local D1
- **INTG-02**: Full DO alarm tick loop exercised in integration test
- **INTG-03**: Schema drift detection between test SQLite and production D1

### Dashboard

- **DASH-01**: Simulation results viewable in React dashboard
- **DASH-02**: Equity curve charts for each strategy

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Monte Carlo simulation | Sample sizes too small per strategy for statistical validity in prediction markets |
| Parameter optimization / grid search | Curve-fitting risk; PROJECT.md constraint: test strategies as-is |
| Walk-forward re-optimization | Violates no-strategy-modification constraint; needs larger datasets |
| Cross-platform arb spread generation | Complexity of synchronized dual-platform price feeds; deferred |
| Real-time paper trading dashboard | WebSocket/SSE doesn't fit CF Workers request-scoped model |
| Strategy code modifications | Simulation tests existing strategies unchanged |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | TBD | Pending |
| TEST-02 | TBD | Pending |
| TEST-03 | TBD | Pending |
| DATA-01 | TBD | Pending |
| DATA-02 | TBD | Pending |
| DATA-03 | TBD | Pending |
| DATA-04 | TBD | Pending |
| DATA-05 | TBD | Pending |
| DATA-06 | TBD | Pending |
| DATA-07 | TBD | Pending |
| SEED-01 | TBD | Pending |
| SEED-02 | TBD | Pending |
| SEED-03 | TBD | Pending |
| SEED-04 | TBD | Pending |
| SEED-05 | TBD | Pending |
| EXCH-01 | TBD | Pending |
| EXCH-02 | TBD | Pending |
| EXCH-03 | TBD | Pending |
| EXCH-04 | TBD | Pending |
| EXCH-05 | TBD | Pending |
| EXCH-06 | TBD | Pending |
| EXCH-07 | TBD | Pending |
| BT-01 | TBD | Pending |
| BT-02 | TBD | Pending |
| BT-03 | TBD | Pending |
| BT-04 | TBD | Pending |
| BT-05 | TBD | Pending |
| BT-06 | TBD | Pending |
| BT-07 | TBD | Pending |
| PAPER-01 | TBD | Pending |
| PAPER-02 | TBD | Pending |
| PAPER-03 | TBD | Pending |
| RPT-01 | TBD | Pending |
| RPT-02 | TBD | Pending |
| RPT-03 | TBD | Pending |
| RPT-04 | TBD | Pending |
| RPT-05 | TBD | Pending |
| RPT-06 | TBD | Pending |
| RPT-07 | TBD | Pending |
| RPT-08 | TBD | Pending |
| RPT-09 | TBD | Pending |
| RPT-10 | TBD | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 0
- Unmapped: 38 ⚠️

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after initial definition*
