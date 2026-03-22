# Requirements: Trade Bot Simulation & Testing

**Defined:** 2026-03-21
**Core Value:** Confidently evaluate and compare all 8 trading strategies against realistic market scenarios before risking real capital.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Test Infrastructure

- [x] **TEST-01**: Vitest configured with in-memory SQLite for strategy unit tests
- [x] **TEST-02**: Drizzle schema applied to in-memory SQLite matching production D1 schema
- [x] **TEST-03**: Each of the 8 strategies has at least one unit test exercising a full tick cycle

### Market Data Generation

- [x] **DATA-01**: Market data generator produces bull trend price series (probability 0→1 bounded, realistic trajectory)
- [x] **DATA-02**: Market data generator produces bear trend price series
- [x] **DATA-03**: Market data generator produces flat/sideways price series
- [x] **DATA-04**: Market data generator produces high-volatility price series
- [x] **DATA-05**: Market data generator produces crash scenario price series (sudden reversal)
- [x] **DATA-06**: Generated data conforms to existing `markets` and `prices` Drizzle schema
- [x] **DATA-07**: Generator uses seeded PRNG for reproducible scenarios across runs

### Bot Seeder

- [ ] **SEED-01**: Seeder creates valid bot_instances rows for all 8 bot types with correct typed configs
- [ ] **SEED-02**: Seeder generates matching market and price data for each bot's trading pairs
- [ ] **SEED-03**: Seeder populates pre-existing trades, positions, and orders for analytics testing
- [ ] **SEED-04**: Seeder validates all bot configs with Zod schemas before insertion (no silent NaN failures)
- [ ] **SEED-05**: Seeder is callable as a CLI command and as a programmatic API

### Exchange Simulation

- [x] **EXCH-01**: SimExchangeClient implements the full ExchangeClient interface
- [x] **EXCH-02**: SimExchangeClient serves prices from seeded data at current tick timestamp only (look-ahead bias guard)
- [x] **EXCH-03**: SimExchangeClient applies Polymarket fee schedule (0% maker / 2% taker) on fills
- [x] **EXCH-04**: SimExchangeClient applies Kalshi fee schedule (1.75¢/contract max) on fills
- [x] **EXCH-05**: SimExchangeClient models partial fills and leg-2 failure at configurable rates for cross-arb
- [x] **EXCH-06**: SimExchangeClient supports configurable virtual starting balance per bot
- [x] **EXCH-07**: createExchangeClient factory extended with simulation mode (one-line production change)

### Backtest Engine

- [x] **BT-01**: BacktestClock advances tick-by-tick at configurable intervals, replacing wall clock
- [x] **BT-02**: Backtest engine drives StrategyTickFn calls in time order using BacktestClock
- [x] **BT-03**: SimulatedBot duck-types BaseBotDO interface (config access, recordTrade, getStatus)
- [x] **BT-04**: PortfolioRisk.isDailyLossBreached() uses injectable clock instead of new Date()
- [x] **BT-05**: Each backtest run uses an isolated database (no cross-contamination between runs)
- [x] **BT-06**: Equity curve logged as timestamped balance snapshots during replay
- [x] **BT-07**: LLM-dependent strategies (llm-assessor, deep-research) use a mock LLM client in backtest

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

### Polymarket Client Improvements

- [x] **POLY-01**: HMAC signing uses base64-decoded API secret and produces URL-safe base64 output matching official Polymarket clob-client SDK
- [x] **POLY-02**: HMAC signing extracted to standalone exported function with unit tests for regression prevention
- [ ] **POLY-03**: placeOrder routes to NEG_RISK_EXCHANGE contract when isNegRisk is true, CTF_EXCHANGE when false (default backward-compatible)
- [x] **POLY-04**: Non-2xx CLOB API responses throw ClobApiError with status code, context, and response body; isRetryable/isAuthError getters classify errors
- [ ] **POLY-05**: Idempotent GET methods retry up to 3 times on retryable errors (429, 5xx) with exponential backoff; placeOrder and cancelOrder never retry
- [ ] **POLY-06**: markets table has nullable clobTokenIds and negRiskMarketId columns with Drizzle migration

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
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 1 | Complete |
| DATA-01 | Phase 2 | Complete |
| DATA-02 | Phase 2 | Complete |
| DATA-03 | Phase 2 | Complete |
| DATA-04 | Phase 2 | Complete |
| DATA-05 | Phase 2 | Complete |
| DATA-06 | Phase 2 | Complete |
| DATA-07 | Phase 2 | Complete |
| SEED-01 | Phase 5 | Pending |
| SEED-02 | Phase 5 | Pending |
| SEED-03 | Phase 5 | Pending |
| SEED-04 | Phase 5 | Pending |
| SEED-05 | Phase 5 | Pending |
| EXCH-01 | Phase 3 | Complete |
| EXCH-02 | Phase 3 | Complete |
| EXCH-03 | Phase 3 | Complete |
| EXCH-04 | Phase 3 | Complete |
| EXCH-05 | Phase 3 | Complete |
| EXCH-06 | Phase 3 | Complete |
| EXCH-07 | Phase 3 | Complete |
| BT-01 | Phase 4 | Complete |
| BT-02 | Phase 4 | Complete |
| BT-03 | Phase 4 | Complete |
| BT-04 | Phase 4 | Complete |
| BT-05 | Phase 4 | Complete |
| BT-06 | Phase 4 | Complete |
| BT-07 | Phase 4 | Complete |
| PAPER-01 | Phase 7 | Pending |
| PAPER-02 | Phase 7 | Pending |
| PAPER-03 | Phase 7 | Pending |
| RPT-01 | Phase 6 | Pending |
| RPT-02 | Phase 6 | Pending |
| RPT-03 | Phase 6 | Pending |
| RPT-04 | Phase 6 | Pending |
| RPT-05 | Phase 6 | Pending |
| RPT-06 | Phase 6 | Pending |
| RPT-07 | Phase 6 | Pending |
| RPT-08 | Phase 6 | Pending |
| RPT-09 | Phase 6 | Pending |
| RPT-10 | Phase 6 | Pending |
| POLY-01 | Phase 8 | Complete |
| POLY-02 | Phase 8 | Complete |
| POLY-03 | Phase 8 | Pending |
| POLY-04 | Phase 8 | Complete |
| POLY-05 | Phase 8 | Pending |
| POLY-06 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-22 after Phase 8 planning*
