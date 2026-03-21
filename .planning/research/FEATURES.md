# Feature Research

**Domain:** Trading bot simulation, backtesting, and seeding layer for prediction markets (Polymarket/Kalshi)
**Researched:** 2026-03-21
**Confidence:** MEDIUM — prediction market backtesting is a specialized domain; general trading bot patterns are HIGH confidence; prediction-market-specific nuances are MEDIUM based on limited specialized tooling available

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a backtesting/simulation layer must have or it fails to validate anything meaningful.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Exchange mock that replaces real clients | Without it, strategies cannot run in simulation at all; the existing `ExchangeClient` interface was explicitly designed to support swapping | HIGH | Must implement the full `ExchangeClient` interface; drives order fills from seeded data rather than real APIs |
| Market data seeding (generated scenarios) | Without seeded data there is nothing to replay; the seeder is the entry point for every other feature | MEDIUM | Must produce rows compatible with existing `markets`, `prices`, `bot_instances`, `orders`, `trades`, `positions` schema |
| Scenario diversity: bull, bear, flat, volatile, crash | A strategy that only works in one condition is not validated; testers expect at minimum directional and volatility axes | MEDIUM | Five scenario types named in PROJECT.md; generator must produce realistic probability trajectories (0–1 bounded, mean-reverting) |
| Per-strategy PnL report | The primitive output any tester expects — did the strategy make money? | LOW | `core/risk/analytics` already has Sharpe, drawdown, PnL functions; report layer collects and formats them |
| Sharpe ratio per strategy per scenario | Risk-adjusted return is the standard lens; raw PnL without it is insufficient for comparison | LOW | Already implemented in `core/risk/analytics`; just needs feeding with backtest trade data |
| Maximum drawdown per strategy | Industry-standard risk metric; users immediately ask "what was the worst loss sequence?" | LOW | Already implemented in `core/risk/analytics` |
| Win rate per strategy | Most basic trade quality metric; expected alongside PnL | LOW | Count of profitable closed trades / total closed trades |
| CLI output for all results | PROJECT.md explicitly chose CLI over dashboard; results must be readable without a browser | LOW | Formatted tables, one block per strategy, one column per scenario |
| Strategy comparison table | Side-by-side view across all 8 strategies per scenario is the point of running multiple strategies | LOW | Depends on per-strategy report being available |
| Unit tests via Vitest + in-memory SQLite | Consumers of this layer will expect strategy logic to have test coverage; Vitest is already in the stack | MEDIUM | Requires a test SQLite setup (using `better-sqlite3` or `@electric-sql/pglite`) compatible with Drizzle schema |
| Integration tests via Wrangler dev + D1 local | Validates the full tick loop including DO alarm behavior; cannot be replaced by unit tests | MEDIUM | Wrangler `miniflare` provides local D1; integration tests confirm the mock exchange wires correctly |

---

### Differentiators (Competitive Advantage)

Features that raise the quality of insight beyond the minimum a tester would accept.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Real market data capture and replay | Lets strategies run against actual resolved Polymarket/Kalshi events rather than synthetic data; removes the "but is the data realistic?" objection | HIGH | Requires fetching historical CLOB snapshots from Polymarket API and historical trade data from Kalshi REST API; store as parquet or JSON snapshots; replay through mock exchange |
| Profit factor metric | Gross profit / gross loss; more informative than win rate alone because it weights trade size; expected by quants | LOW | Computed from trade records; no additional infrastructure |
| Sortino ratio | Targets downside volatility only; better than Sharpe for binary-outcome markets where upside is capped | LOW | Slight extension of existing Sharpe implementation |
| Per-scenario equity curve log | Timestamped running balance during a backtest; shows *when* drawdowns occurred, not just how deep | MEDIUM | Requires emitting balance snapshots during replay loop; can write to a separate `backtest_equity` table or in-memory array |
| Mock exchange fill realism: taker fee simulation | Prediction markets have asymmetric fees (Kalshi 1.75¢/contract max, Polymarket 0% maker / 2% taker); ignoring this inflates returns | LOW | Encode fee schedules into the mock exchange; apply on every simulated fill |
| Probability calibration tracking for LLM and assessor strategies | `llm-assessor` and `deep-research` strategies produce probabilistic signals; measuring Brier score against resolution tells you if the model is calibrated, not just profitable | MEDIUM | Requires capturing the strategy's predicted probability at entry and the market's resolved outcome; Brier score = (prediction - outcome)^2 averaged |
| Per-strategy scenario heatmap in CLI | ASCII or structured table showing each strategy × scenario cell colored by Sharpe; allows instant pattern recognition | LOW | Formatting only; data already produced by per-strategy reports |
| Look-ahead bias guard in mock exchange | The most common source of fake backtest results; mock must only expose prices that were available at the simulated timestamp | MEDIUM | Replay loop must enforce strict time ordering; mock `getOrderBook()` and `getPrice()` must only return data at or before current tick timestamp |
| Configurable virtual starting balance per bot | Different strategies have different capital needs; allowing per-bot starting balance makes comparison fair | LOW | Single config parameter on the mock exchange adapter |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Dashboard / UI for simulation results | "Would be nice to see charts" | PROJECT.md explicitly deferred this; adds significant scope (React charts, data persistence layer for results, API endpoints) for a dev-time tool that only needs to be readable | CLI report with structured output; pipe to `jq` or redirect to file if persistence is needed |
| Monte Carlo simulation | Sounds rigorous; often asked for by quants | For 8 strategies with limited trade samples from binary markets, Monte Carlo adds complexity without meaningful statistical power; prediction market sample sizes are too small per-strategy to make Monte Carlo distributions valid | Run across multiple scenarios instead; scenario diversity achieves regime coverage without resampling assumptions |
| Parameter optimization / grid search | "Let me find the best config for each strategy" | Curve-fitting risk: optimizing parameters against the same data used for evaluation produces strategies that only look good historically; violates the "test existing strategies as-is" constraint in PROJECT.md | Fix strategy configs at realistic values and evaluate as-is; only tune if a strategy is clearly broken |
| Cross-platform arb spread generation | Logical feature given the cross-arb strategy exists | PROJECT.md explicitly deferred arb scenarios; they require synchronized price feeds from both platforms at the same timestamp, which makes the generator significantly more complex | Focus on directional trends first; note arb scenario generation as a deferred item |
| Real-time paper trading dashboard | Users expect live charts while paper trading | Requires WebSockets or SSE from the Worker, a live charting frontend, and long-running processes — none of which fit Cloudflare Workers' request-scoped execution model | CLI that polls and prints periodic snapshots, or rely on the existing React dashboard's trade/position views which already read from D1 |
| Walk-forward / rolling-window re-optimization | Standard quant validation technique | Requires running the same strategy multiple times with different parameter sets; violates "no strategy modification" constraint and creates scope creep; meaningful only with larger datasets than prediction markets typically provide per-event category | Single train/test split across scenarios (generated vs. captured data) achieves out-of-sample validation |
| Multi-exchange slippage modeling | Realistic for stock markets | Polymarket and Kalshi are CLOBs with published order books; the realistic model is fee simulation + fill-at-mid-price with a small spread, not slippage as a separate dimension | Simulate taker/maker fees accurately; use mid-price fill or best-ask fill consistently |

---

## Feature Dependencies

```
[Market Data Seeder]
    └──required by──> [Exchange Mock (SimExchangeClient)]
                          └──required by──> [Backtest Engine (replay loop)]
                                                └──required by──> [Per-strategy PnL / Sharpe / Drawdown Report]
                                                                      └──required by──> [Strategy Comparison Table]
                                                                      └──required by──> [Scenario Heatmap (CLI)]

[Exchange Mock]
    └──required by──> [Paper Trading Mode]
                          └──enhances──> [Per-strategy PnL / Sharpe / Drawdown Report]

[Real Market Data Capture]
    └──enhances──> [Exchange Mock]  (replay from captured data instead of generated)

[Look-Ahead Bias Guard]
    └──required by──> [Backtest Engine]  (must be built in, not bolted on)

[Fee Simulation]
    └──required by──> [Exchange Mock]  (every fill must apply fees)

[Equity Curve Log]
    └──requires──> [Backtest Engine]  (produced during replay)
    └──enhances──> [Per-strategy PnL Report]

[Probability Calibration / Brier Score]
    └──requires──> [Backtest Engine]  (needs predicted probability at fill time)
    └──requires──> [Real Market Data Capture]  (needs resolved outcomes)

[Unit Tests (Vitest)]
    └──requires──> [Exchange Mock]  (mock is the seam for unit testing strategies in isolation)
    └──requires──> [In-memory SQLite setup]

[Integration Tests (Wrangler dev)]
    └──requires──> [Exchange Mock]
    └──requires──> [Market Data Seeder]  (seeds D1 before tests run)
```

### Dependency Notes

- **Exchange mock requires market data seeder:** The mock exchange serves price data during backtest replay; without seeded prices there is nothing to serve. The seeder must run before any backtest.
- **Look-ahead bias guard is a property of the exchange mock, not a separate step:** It must be designed into the mock's `getPrice()` / `getOrderBook()` interface from day one. Retrofitting it later requires re-running all backtests.
- **Fee simulation is a property of the mock, not the report:** Fees must be deducted at fill time inside the mock exchange so that trade records already reflect net returns. The report layer should not apply fees post-hoc.
- **Real market data capture enhances but does not replace generated data:** Generated scenarios run first (faster, controllable); captured data adds realism validation. They share the same mock exchange interface.
- **Probability calibration requires both a mock and real resolution outcomes:** It only makes sense for strategies that emit a probability signal (`llm-assessor`, `deep-research`). Requires capturing the signal at entry alongside the market's eventual resolution (YES=1, NO=0).

---

## MVP Definition

### Launch With (v1)

The minimum needed to evaluate all 8 strategies across meaningful scenarios.

- [ ] **Market data seeder** — generates `markets`, `prices`, `bot_instances` rows for all 8 bot types across 5 scenario types (bull, bear, flat, volatile, crash); produces data compatible with existing Drizzle schema
- [ ] **SimExchangeClient (exchange mock)** — implements the full `ExchangeClient` interface; serves prices from seeded data at the current tick timestamp; enforces look-ahead bias guard; applies platform fee schedules on fills
- [ ] **Backtest engine (replay loop)** — drives tick calls through each strategy's `StrategyTickFn` in time order; feeds the sim exchange; persists resulting trades/positions to a test D1 or in-memory store
- [ ] **Per-strategy metrics report** — collects PnL, Sharpe ratio, max drawdown, win rate, profit factor from trade records after replay; formats as CLI output
- [ ] **Strategy comparison table** — aggregates per-strategy metrics into a single cross-strategy, cross-scenario table; identifies best/worst strategy per scenario
- [ ] **Vitest unit test suite** — covers each strategy's tick function with the mock exchange; uses in-memory SQLite for the DB layer
- [ ] **Wrangler dev integration tests** — end-to-end tick execution against local D1; confirms the mock exchange wires correctly through the DO alarm path

### Add After Validation (v1.x)

Add once the core backtest loop is working and producing trustworthy numbers.

- [ ] **Real market data capture and replay** — fetch historical data from Polymarket and Kalshi APIs; store snapshots; replay through the same mock exchange; trigger when generated-scenario results need real-data validation
- [ ] **Equity curve logging** — emit timestamped balance snapshots during replay; include in CLI output as an ASCII sparkline or structured log; trigger when users want to see *when* drawdowns happen
- [ ] **Sortino ratio** — add alongside Sharpe in the report; low-effort extension; trigger when Sharpe alone feels insufficient for binary-outcome markets
- [ ] **Paper trading mode** — run live market feeds through the same mock exchange with a simulated balance; trigger when strategies are validated in backtest and a live-feed test is needed before real capital

### Future Consideration (v2+)

Defer until the core testing layer proves its value.

- [ ] **Probability calibration / Brier score** — meaningful only for `llm-assessor` and `deep-research`; requires resolved outcome data; defer until those strategies are stable
- [ ] **Dashboard UI for simulation results** — PROJECT.md explicitly deferred; reconsider if CLI output becomes unwieldy for more than 8 strategies
- [ ] **Arb spread scenario generation** — deferred per PROJECT.md; add when directional scenarios are validated and cross-platform sync complexity is worth tackling

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Market data seeder (generated scenarios) | HIGH | MEDIUM | P1 |
| SimExchangeClient (exchange mock) | HIGH | HIGH | P1 |
| Look-ahead bias guard (built into mock) | HIGH | LOW | P1 — must ship with mock |
| Fee simulation (built into mock) | HIGH | LOW | P1 — must ship with mock |
| Backtest engine replay loop | HIGH | MEDIUM | P1 |
| Per-strategy PnL / Sharpe / drawdown / win rate report | HIGH | LOW | P1 |
| Strategy comparison CLI table | HIGH | LOW | P1 |
| Vitest unit tests | HIGH | MEDIUM | P1 |
| Wrangler integration tests | MEDIUM | MEDIUM | P1 |
| Profit factor metric | MEDIUM | LOW | P2 |
| Equity curve logging | MEDIUM | MEDIUM | P2 |
| Sortino ratio | LOW | LOW | P2 |
| Real market data capture | HIGH | HIGH | P2 |
| Paper trading mode | MEDIUM | MEDIUM | P2 |
| Probability calibration / Brier score | MEDIUM | MEDIUM | P3 |
| Dashboard UI | LOW | HIGH | P3 — explicitly deferred |
| Monte Carlo resampling | LOW | HIGH | P3 — anti-feature for this domain |

**Priority key:**
- P1: Must have for launch — without these the backtest layer cannot function or cannot be trusted
- P2: Should have — adds rigor or realism; add in next iteration after P1 is validated
- P3: Nice to have or explicitly deferred — revisit at v2

---

## Competitor Feature Analysis

Prediction-market-specific backtesting tooling is sparse. Three known tools exist:

| Feature | PolySimulator | evan-kolberg/prediction-market-backtesting | This Project |
|---------|--------------|---------------------------------------------|--------------|
| Platform coverage | Polymarket + Kalshi | Polymarket + Kalshi | Polymarket + Kalshi |
| Data source | Historical (API) | Historical parquet via DuckDB | Generated + captured |
| Strategy interface | Custom (web-based) | Python strategy classes | Existing `StrategyTickFn` (no modification) |
| Fee simulation | Unknown | YES — Kalshi and Polymarket fee schedules | YES — part of mock exchange |
| Look-ahead bias guard | Unknown | YES — CLOB taker-side filtering | YES — enforced in mock exchange |
| Output | Web charts | Equity curves, Sharpe, drawdown, Brier | CLI table: PnL, Sharpe, drawdown, win rate |
| Multi-strategy comparison | Unknown | Per-strategy | All 8 simultaneously |
| Brier score | Unknown | YES | P3 (deferred) |
| Unit test integration | No | No | YES (Vitest) |

The key differentiator for this project is testing all 8 strategies through their existing code without modification, via the `ExchangeClient` interface swap. Competitors require rewriting strategy logic to fit their framework.

---

## Sources

- [PolySimulator — Prediction market backtesting for Polymarket & Kalshi](https://polysimulator.com/backtesting)
- [evan-kolberg/prediction-market-backtesting on GitHub](https://github.com/evan-kolberg/prediction-market-backtesting)
- [Interactive Brokers: Vector-Based vs. Event-Based Backtesting](https://www.interactivebrokers.com/campus/ibkr-quant-news/a-practical-breakdown-of-vector-based-vs-event-based-backtesting/)
- [LuxAlgo: Top 7 Metrics for Backtesting Results](https://www.luxalgo.com/blog/top-7-metrics-for-backtesting-results/)
- [QuantStrategy.io: Essential Backtesting Metrics — Drawdown, Sharpe, Profit Factor](https://quantstrategy.io/blog/essential-backtesting-metrics-understanding-drawdown-sharpe/)
- [Gainium: Common Backtesting Problems and Solutions](https://gainium.io/blog/common-backtesting-problems)
- [Gunbot: Implementing Paper Trading for Trading Bot Strategy Testing](https://www.gunbot.com/topics/implementing-paper-trading-for-trading-bot-strategy-testing/)
- [CW Data Solutions: Calibration and Skill of the Kalshi Prediction Markets](https://www.cwdatasolutions.com/post/calibration-and-skill-of-the-kalshi-prediction-markets)
- [24Markets: Backtesting Effectively — Avoiding Curve Fitting](https://24markets.com/education/backtesting-effectively-avoiding-curve-fitting)

---

*Feature research for: trading bot simulation and backtesting layer (Polymarket/Kalshi)*
*Researched: 2026-03-21*
