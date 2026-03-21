# Pitfalls Research

**Domain:** Trading bot backtesting, simulation, and paper trading on prediction markets (Polymarket + Kalshi)
**Researched:** 2026-03-21
**Confidence:** HIGH (architecture-specific pitfalls from codebase inspection) / MEDIUM (general backtesting pitfalls from multiple sources)

---

## Critical Pitfalls

### Pitfall 1: Lookahead Bias Through Shared Database State

**What goes wrong:**
The backtest engine runs strategy ticks against a D1 database that contains seeded historical data. If the seeder populates the full price history upfront and the strategy reads the `prices` table without a time filter, every tick silently has access to future price data. The strategy "knows" tomorrow's price today. Backtested Sharpe ratios and win rates will be wildly optimistic and completely invalid.

**Why it happens:**
Strategies like `cross-arb` and `market-maker` read from the `prices` table directly (`db.select().from(prices)`) to assess spread or momentum. The seeder populates all price rows for a scenario at once. Without an explicit "as-of timestamp" guard on every query, every strategy tick is reading the full price series.

**How to avoid:**
The backtest engine must enforce a "current simulation time" cursor. Every read to `prices`, `markets`, and `orders` tables must be wrapped with a `WHERE created_at <= :sim_time` filter. The cleanest approach: pass `simTime: Date` into the mock `ExchangeClient` and into a wrapping DB proxy that appends the temporal filter to all reads automatically. Never let strategy code perform unguarded `db.select()` calls during backtest.

**Warning signs:**
- Backtest Sharpe ratio is above 3.0
- Win rates exceed 70% across all market conditions (bull, bear, flat, crash)
- Strategy performance collapses completely in paper trading vs backtest
- Trend-following strategies show zero lag (they react to price changes in the same tick the change was seeded)

**Phase to address:**
The backtest engine scaffold phase — before any strategy is exercised through it. The temporal guard must be a core invariant of the engine, not added later.

---

### Pitfall 2: Simulated Exchange Fills at Signal Price (No Slippage Model)

**What goes wrong:**
The mock `ExchangeClient` returns `filledPrice = orderRequest.price` for every order. In the real Polymarket and Kalshi orderbooks, especially on Kalshi which frequently has 1–100 bid-ask spreads, fills execute at a worse price than quoted. The backtest records trades at exact signal price, making every strategy appear more profitable than it will be live.

**Why it happens:**
`ExchangeClient.placeOrder()` returns an `OrderResult` with `filledPrice?: number`. The simplest mock implementation sets `filledPrice` equal to the requested price. Strategies like `market-maker` that are sensitive to spread capture will show artificially high margins.

**How to avoid:**
The mock exchange must model a spread and apply a slippage penalty. For prediction market binary contracts, a reasonable baseline is: fill price = requested price ± (half the configured bid-ask spread for that market) + a uniform random noise of ±0.001–0.003. For `market-maker` strategy specifically, always fill against the less favorable side of the book. The `OrderBook` type already exists in `ExchangeClient` — the mock should maintain a simulated book and consume liquidity from it. If order size exceeds available size at a level, fill should be partial (`status: "partial"`).

**Warning signs:**
- Mock `ExchangeClient.placeOrder()` always returns `status: "filled"` with `filledSize === order.size`
- `filledPrice` is always exactly equal to `order.price`
- Market-maker strategy shows consistent positive spread capture with no variance
- Paper trading results are materially worse than backtest results on the same time window

**Phase to address:**
Mock ExchangeClient implementation phase. Define the slippage model as a configurable parameter (default realistic, configurable for "ideal fill" sensitivity testing).

---

### Pitfall 3: Strategy Clock Tied to Wall Time in Tests

**What goes wrong:**
`PortfolioRisk.isDailyLossBreached()` calls `new Date().toISOString()` to determine "today." `BaseBotDO.alarm()` uses the real wall clock to schedule next ticks. When running a backtest over a compressed time window (e.g., 30 days of history in 2 seconds), the daily circuit breaker never resets because wall-clock date never changes. Loss accumulates across all simulated days without the circuit breaker firing per simulated day.

**Why it happens:**
Wall clock access is implicit in the existing codebase (`new Date()` in `portfolio.ts` line 107). During testing, nobody patches it because the strategy interface doesn't accept a clock parameter. The backtest engine advances simulated time internally but the strategy still sees real wall time.

**How to avoid:**
Inject a clock abstraction. Before building the backtest engine, refactor `PortfolioRisk` to accept an optional `now: () => Date` parameter (defaults to `() => new Date()`). The backtest engine passes a controlled clock that returns `simTime`. Alternatively, a simpler approach for this project: wrap the daily loss check call-site in the mock DO with a simulated-date override rather than touching production code.

**Warning signs:**
- Daily loss circuit breaker never fires during a multi-day backtest run
- All simulated days show the same calendar date in audit logs
- `bot_metrics` rows timestamped identically regardless of simulated time

**Phase to address:**
Backtest engine scaffold phase, before the daily circuit breaker behavior is tested. Must be decided before strategy unit tests are written, since test isolation depends on a controllable clock.

---

### Pitfall 4: Seeder Produces Invalid Config for Strategy-Specific Types

**What goes wrong:**
Each of the 8 strategies has its own typed config (e.g., `CrossArbConfig`, `LadderStraddleConfig`). Strategies cast config unsafely: `(bot as any).config as CrossArbConfig`. If the seeder generates a bot with `botType: "cross-arb"` but is missing required fields like `platforms`, `minSpread`, or `maxPositionSize`, the strategy silently proceeds with `undefined` values. The first arithmetic operation produces `NaN`, which propagates through risk checks and trade sizing — the risk check passes with `NaN` cost, resulting in ghost trades with zero or NaN size being persisted.

**Why it happens:**
There is no runtime schema validation on bot configs (confirmed in the architecture analysis: "No input validation library detected. Strategy configs are cast with `(bot as any).config as XConfig` — no runtime schema validation"). The seeder author writes a config object by hand or from a template that becomes stale.

**How to avoid:**
Define Zod (or similar) schemas for each strategy config. Validate in the seeder before inserting. Also validate at the top of each `strategy.ts` tick function before the config cast — throw an error if required fields are missing. This is a testing-layer concern; do not modify production strategy logic to add validation (which is out of scope), but do validate in the seeder and test harness.

**Warning signs:**
- Backtest produces trades with `price: 0`, `size: 0`, or `size: NaN`
- Risk checks always pass because `cost = NaN * NaN = NaN` and `NaN > limit` is false
- Strategy logs show `undefined` values for spread, platform, or other config fields
- All 8 strategies complete ticks without error but record no trades

**Phase to address:**
Seeder implementation phase — validate every bot config against its strategy's expected shape before inserting. Add an assertion check in the test harness that seeds produce at least one valid trade per simulated scenario.

---

### Pitfall 5: Cross-Arb Partial Fill Risk Not Modeled in Simulation

**What goes wrong:**
The `cross-arb` strategy has a documented known issue: if leg 1 (buy YES on cheap exchange) succeeds but leg 2 (buy NO on expensive exchange) fails, the position is unhedged. In production this is logged and ignored. In backtesting, if the mock exchange always fills both legs, the simulation never surfaces the frequency or cost of partial fills. The strategy's true risk profile is understated.

**Why it happens:**
The mock exchange returns success for all orders. The code path for `sellResult.status === "failed"` exists but is never triggered in simulation. Real Kalshi markets with low liquidity will reject or partially fill leg 2 orders frequently.

**How to avoid:**
The mock exchange should simulate leg 2 rejection at a configurable failure rate (default: 5% of arb attempts). When leg 2 fails, the backtest engine should record leg 1 as a one-sided position and mark it for resolution at scenario end. The CLI report should separately break out "arb attempts," "completed arb pairs," and "orphaned legs" for the cross-arb strategy.

**Warning signs:**
- Cross-arb backtest shows zero single-leg positions
- Cross-arb PnL has no negative outliers despite operating in thin-liquidity scenarios
- The word "partial-fill" never appears in backtest logs

**Phase to address:**
Mock ExchangeClient implementation. The failure rate must be a scenario parameter, not hardcoded.

---

### Pitfall 6: LLM-Assessor and Deep-Research Strategies Cannot Run in Backtest Without API Stubbing

**What goes wrong:**
`llm-assessor` and `deep-research` strategies make external API calls (LLM inference, web research). If the mock `ExchangeClient` is swapped but the LLM client is not, the backtest makes real LLM API calls: it incurs cost, is non-deterministic, and requires network access from the test environment. If the LLM client is simply not stubbed, the strategy throws and the tick is skipped silently — making these two strategies appear to do nothing in backtest.

**Why it happens:**
The backtest plan focuses on mocking `ExchangeClient` via the factory pattern, but LLM/research clients are a separate dependency not covered by that interface. It is easy to not notice this until you try to run those strategies in simulation.

**How to avoid:**
Audit every external dependency each strategy uses before building the mock layer. For `llm-assessor` and `deep-research`, create a `MockLLMClient` that returns deterministic fixed assessments (configurable per test scenario: "bullish", "bearish", "neutral"). The factory that constructs LLM clients must be patchable the same way `createExchangeClient` is. Treat LLM calls as a second mock boundary alongside the exchange mock.

**Warning signs:**
- Strategy tick for `llm-assessor` completes in < 10ms in backtest (real LLM would take hundreds of ms)
- `llm-assessor` records zero trades across all scenarios
- Network requests appear in test runner output
- Test suite fails with "fetch is not defined" or API key errors

**Phase to address:**
Before the seeder or backtest engine — during the dependency audit that establishes what needs mocking. Do this as the first step of the simulation layer design.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Always fill mock orders at signal price | Simpler mock implementation | Overstated PnL; paper trading divergence hard to diagnose | Never — add minimal spread from day 1 |
| Hardcode scenario data in seeder | Fast to write first scenario | Adding new scenarios requires code changes; scenarios not composable | Only for a throw-away spike, not for the seeder that ships |
| Use wall clock in backtest time loop | No code changes to existing strategies | Circuit breakers and daily resets do not work correctly | Never — inject a controlled clock |
| Run full backtest in a single Worker request | Avoids complex orchestration | Cloudflare Workers have a 30s CPU time limit; long backtests will be killed | Acceptable only for very short scenarios (< 50 ticks total) |
| Reuse the live D1 database for backtest | No separate database to set up | Backtest writes contaminate real data; catastrophic if run against production binding | Never — always use a separate D1 binding or in-memory SQLite for backtest |
| Skip partial-fill simulation for arb | Easier mock | Cross-arb looks risk-free in simulation; false confidence for production deployment | Never for cross-arb strategy testing |

---

## Integration Gotchas

Common mistakes when connecting to external services in the simulation context.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Cloudflare D1 (via Drizzle) | Running backtest against the production `DB` binding — seeded data pollutes real tables | Use a dedicated `DB_TEST` binding pointing to a separate D1 database, or use `@miniflare/d1` in-memory for unit tests |
| Vitest + in-memory SQLite | Using `better-sqlite3` (Node.js binary) — fails in workerd runtime | Use `@miniflare/d1` or the Cloudflare Vitest pool which provides a real D1-compatible in-memory store |
| ExchangeClient factory | Calling `createExchangeClient(env, platform)` directly in tests — requires real API credentials in env | Create a `createSimulatedExchangeClient(scenario)` factory that the backtest engine uses instead of the real factory |
| `BaseBotDO` instantiation in unit tests | Trying to `new BotDO(ctx, env)` manually — Durable Objects require a real `DurableObjectState` | Use `runInDurableObject()` from `@cloudflare/vitest-pool-workers` to get a properly initialized DO instance |
| Wrangler dev + Vitest integration | Running integration tests against `wrangler dev` while also running unit tests with in-memory SQLite — schema drift between environments | Keep a single authoritative schema file; run `wrangler d1 migrations apply --local` before integration tests |
| Polymarket/Kalshi real API in paper trading | Paper trading mode accidentally calling real `placeOrder()` — places real orders with simulated balance | Gate the exchange factory with a `PAPER_TRADING=true` env var; assert in factory that paper mode never returns a real client |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Running all 8 strategies × 5 scenarios in a single Worker invocation | Request timeout, Worker CPU limit exceeded | Run each strategy-scenario pair as an isolated invocation or use streaming/chunked execution | At ~20 ticks × 8 strategies × 5 scenarios = 800 tick calls per backtest run |
| `db.select().from(prices)` with no market filter — full table scan per tick | Backtest slows dramatically as seeded price rows grow | Always scope price queries to `WHERE market_id = ?` and `WHERE created_at <= ?` | At ~10 markets × 100 candles each = 1,000 price rows — noticeable at 500+ |
| Generating synthetic price series in-process using GBM with very high tick resolution | Memory pressure in Worker sandbox; slow generation | Pre-generate and store price series in the database at seed time, not at backtest time | At 50,000+ price points |
| Storing full JSON scenario configs in each bot_instance row | Schema query costs; large row size | Keep scenario config in a separate scenarios table referenced by ID | Negligible at <100 bots; notable at 1,000+ seeded bots |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Simulation writes to production D1 via shared `env.DB` binding | Real trade history contaminated by simulated trades; positions table corrupted | Use separate D1 binding (`DB_TEST`) for all simulation; assert at backtest engine entry that `env.DB` is never used |
| Paper trading mode that places real orders on Polymarket/Kalshi | Real capital at risk under fake balance assumptions | Introduce a `PAPER_TRADING` env flag; the mock ExchangeClient must be the only implementation reachable in paper mode — verify via a type-level or runtime guard |
| Seeder using real platform IDs for simulated markets | Simulated markets that happen to share IDs with real markets cause confusion if real data is later captured | Prefix all seeded market IDs with `sim_` or use a UUID namespace that cannot collide with real platform IDs |
| Exposing backtest CLI output including strategy parameters and thresholds | Reveals edge configuration to observers of terminal output | Document that CLI reports are for internal dev use only; add a warning header to report output |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Seeder:** Bot configs inserted into `bot_instances` but no corresponding `prices` rows seeded for the markets those bots trade — strategies tick but find no market data and silently do nothing. Verify each seeded bot has at least N price rows per market it is configured to trade.
- [ ] **Mock ExchangeClient:** `placeOrder()` returns `status: "filled"` but `getOrder()`, `getOpenOrders()`, and `cancelOrder()` methods are not implemented — strategies that verify order state after placement will throw or behave incorrectly. Implement all 9 interface methods.
- [ ] **Backtest engine:** Time cursor advances but `markets.status` is never updated from `"active"` to `"resolved"` as the simulation passes market end dates — resolution-dependent strategies (ladder-straddle) never close positions.
- [ ] **CLI report:** PnL is calculated from `trades` table entries (entry price) but does not account for resolution outcomes (YES wins at $1.00, NO wins at $0.00) — unrealized PnL rows are reported as if positions are still open.
- [ ] **Paper trading mode:** Real market data is fetched from Polymarket/Kalshi but the mock exchange is used for order placement — this is correct. Verify the factory actually switches on the `PAPER_TRADING` flag and does not fall through to the real client.
- [ ] **Scenario coverage:** Bull and bear scenarios exist but all strategies are tested. Cross-arb and logical-arb require cross-platform price divergence that is not present in a single-platform directional scenario — verify these strategies produce at least some trades in their relevant scenarios or document that they produce none (which is a valid signal).
- [ ] **Unit tests:** Tests pass with in-memory SQLite but the schema applied is different from the production schema (missing migrations or columns) — run schema validation as part of CI to catch drift.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Backtest results contaminated by lookahead bias | MEDIUM | Add temporal filter to DB proxy layer, re-run all scenarios, discard all previous backtest results |
| Seeder wrote to production D1 binding | HIGH | Identify all rows with `sim_` prefixed IDs or scenario timestamps; delete them manually via Drizzle migration or D1 console; audit `positions` and `trades` tables for contamination |
| All backtest results are overly optimistic (slippage not modeled) | MEDIUM | Implement slippage in mock exchange, add bid-ask spread to scenario configs, re-run all scenarios |
| LLM strategies silently skipped in backtest | LOW | Add mock LLM factory, verify tick count for those strategies > 0 after re-run |
| Clock not injected — daily circuit breaker never resets | MEDIUM | Refactor `PortfolioRisk` to accept optional clock param, update all call sites in backtest engine, re-run multi-day scenarios |
| Cross-arb partial fill never simulated | LOW | Add failure rate param to mock exchange, re-run cross-arb scenarios, compare PnL with and without partial fills |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Lookahead bias via unguarded DB reads | Backtest engine scaffold | Assert that any `prices` read in a running backtest has a `created_at <= simTime` filter; write a test that seeds future data and verifies the strategy cannot see it |
| Simulated fills at signal price | Mock ExchangeClient implementation | Unit test: request a fill; verify `filledPrice !== order.price` (slippage applied) |
| Wall clock in strategy circuit breaker | Backtest engine scaffold | Run a 2-day simulated scenario; verify daily circuit breaker resets between day 1 and day 2 |
| Invalid strategy configs from seeder | Seeder implementation | After seeder runs, validate all `bot_instances.config` rows against each strategy's Zod schema |
| Cross-arb partial fill not modeled | Mock ExchangeClient implementation | Enable failure rate > 0, run cross-arb scenario, verify some ticks produce orphaned single-leg positions |
| LLM strategies not stubbed | Dependency audit (before seeder phase) | Both `llm-assessor` and `deep-research` produce > 0 trades in at least one scenario |
| Simulation writing to production DB | Mock ExchangeClient + seeder setup | Assert in test setup that `env.DB` is a test binding; CI should never have production credentials |

---

## Sources

- [Common Pitfalls in Backtesting: A Comprehensive Guide for Algorithmic Traders](https://medium.com/funny-ai-quant/ai-algorithmic-trading-common-pitfalls-in-backtesting-a-comprehensive-guide-for-algorithmic-ce97e1b1f7f7)
- [Backtesting Biases: How Traders Fool Themselves Without Knowing It](https://www.fxreplay.com/learn/backtesting-biases-how-traders-fool-themselves-without-knowing-it)
- [Common Backtesting Problems and Solutions](https://gainium.io/blog/common-backtesting-problems)
- [Backtesting Trading Strategies on Prediction Markets (BSIC)](https://bsic.it/well-can-we-predict-backtesting-trading-strategies-on-prediction-markets-cryptocurrency-contracts/)
- [Prediction Market Backtesting | PolySimulator](https://polysimulator.com/backtesting) — notes on Kalshi bid-ask spread characteristics
- [How to Backtest a Crypto Bot: Realistic Fees, Slippage, and Paper Trading](https://paybis.com/blog/how-to-backtest-crypto-bot/)
- [QuantConnect Slippage Modeling](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/slippage/key-concepts)
- [Testing Durable Objects — Cloudflare Official Docs](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)
- [Cloudflare Workers Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Backtesting Traps: Common Errors to Avoid](https://www.luxalgo.com/blog/backtesting-traps-common-errors-to-avoid/)
- [Freqtrade Strategy Customization — Lookahead Bias Warning](https://www.freqtrade.io/en/stable/strategy-customization/) — canonical description of `shift(-1)` pattern causing future data access
- Architecture analysis of this codebase (`src/worker/core/risk/portfolio.ts`, `src/worker/bots/cross-arb/strategy.ts`, `src/worker/core/exchanges/types.ts`)

---
*Pitfalls research for: Trading bot backtesting/simulation layer on Cloudflare Workers + D1*
*Researched: 2026-03-21*
