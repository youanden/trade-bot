# Architecture Research

**Domain:** Trading bot simulation/backtest layer on Cloudflare Workers
**Researched:** 2026-03-21
**Confidence:** HIGH (grounded in existing codebase analysis + verified industry patterns)

## Standard Architecture

### System Overview

The simulation layer adds three new execution contexts alongside the existing production context. All four share the same strategy code — the only thing that changes per context is what `ExchangeClient` and `Database` instances are injected.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Existing Production Path                      │
│  Cloudflare Alarm → BotDO.tick() → StrategyTickFn(bot, env)          │
│                                         │                             │
│                              createExchangeClient(env, platform)      │
│                              [Real Polymarket/Kalshi client]          │
│                              createDb(env.DB) [Real D1]               │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                    NEW: Simulation Execution Contexts                  │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Backtest Runner (CLI)                                          │  │
│  │  MarketDataFeed ──→ SimulatedExchangeClient                     │  │
│  │  (historical/generated tick data)       ↓                       │  │
│  │  BacktestClock (virtual time)   StrategyTickFn(bot, env)        │  │
│  │  In-memory SQLite DB ←─────────── recordTrade()                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Paper Trading Runner (CLI or Wrangler dev)                     │  │
│  │  Real Polymarket/Kalshi price feeds                             │  │
│  │  SimulatedExchangeClient (fills simulated, orders not sent)     │  │
│  │  Local D1 DB ←─────────── recordTrade()                         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Seeder (CLI / bun script)                                      │  │
│  │  MarketDataGenerator → prices table rows                        │  │
│  │  BotConfigFactory → bot_instances rows                          │  │
│  │  TradeHistoryGenerator → orders / trades / positions rows       │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                         Shared (unchanged)                             │
│  StrategyTickFn (all 8 strategies) — no modifications                  │
│  BaseBotDO.recordTrade() / upsertPosition()                           │
│  PortfolioRisk / Kelly — pure functions, DB-injected                  │
│  Drizzle schema (markets, prices, orders, trades, positions)          │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| `SimulatedExchangeClient` | Implements full `ExchangeClient` interface; feeds prices from `MarketDataFeed`; records simulated fills without hitting real exchanges | `src/simulation/exchange/simulated-client.ts` |
| `MarketDataFeed` | Provides time-indexed price ticks; sourced from generator or captured data; advances a cursor on each call to `getPrice()` | `src/simulation/data/feed.ts` |
| `MarketDataGenerator` | Produces synthetic `prices` table rows for bull/bear/flat/volatile/crash scenarios; outputs are compatible with the existing `prices` schema | `src/simulation/data/generator.ts` |
| `MarketCaptureClient` | Thin wrapper around real Polymarket/Kalshi clients that records responses to a local replay file; used for real-data capture | `src/simulation/data/capture-client.ts` |
| `BacktestClock` | Manages virtual time advancement; replaces `Date.now()` in simulated context; ensures no lookahead bias | `src/simulation/engine/clock.ts` |
| `BacktestEngine` | Orchestrates tick replay: initialises a `SimulatedBot`, advances clock, calls `StrategyTickFn`, collects results | `src/simulation/engine/backtest.ts` |
| `SimulatedBot` | Minimal implementation of `BaseBotDO`-compatible interface for test context; wraps in-memory SQLite DB; provides `recordTrade()` | `src/simulation/engine/simulated-bot.ts` |
| `BotConfigFactory` | Produces valid `BotConfig` objects for each of the 8 bot types with realistic parameters | `src/simulation/seed/config-factory.ts` |
| `MarketSeeder` | Inserts realistic `markets`, `market_links`, and `prices` rows into a target DB | `src/simulation/seed/market-seeder.ts` |
| `TradeHistorySeeder` | Inserts plausible historical `orders`, `trades`, and `positions` rows for each seeded bot | `src/simulation/seed/trade-seeder.ts` |
| `PaperTrader` | Like `BacktestEngine` but uses real price feeds from exchanges; `SimulatedExchangeClient` intercepts `placeOrder` only | `src/simulation/engine/paper-trader.ts` |
| `ReportGenerator` | Computes and formats PnL, Sharpe ratio, max drawdown, win rate per strategy per scenario | `src/simulation/reporting/report.ts` |
| `CLI runner` | Entry point script; parses args, wires components, outputs report to stdout | `src/simulation/cli.ts` |

## Recommended Project Structure

```
src/
├── worker/                    # Existing — unchanged
│   ├── bots/
│   ├── core/
│   └── ...
└── simulation/                # New — all simulation code
    ├── cli.ts                 # Entry: bun run src/simulation/cli.ts
    ├── engine/
    │   ├── backtest.ts        # BacktestEngine
    │   ├── paper-trader.ts    # PaperTrader
    │   ├── simulated-bot.ts   # SimulatedBot (BaseBotDO-compatible)
    │   └── clock.ts           # BacktestClock
    ├── exchange/
    │   └── simulated-client.ts  # SimulatedExchangeClient implements ExchangeClient
    ├── data/
    │   ├── feed.ts            # MarketDataFeed (cursor-based tick iterator)
    │   ├── generator.ts       # MarketDataGenerator (bull/bear/flat/volatile/crash)
    │   └── capture-client.ts  # MarketCaptureClient (record real responses)
    ├── seed/
    │   ├── config-factory.ts  # BotConfigFactory for each of 8 bot types
    │   ├── market-seeder.ts   # Seeds markets + prices into target DB
    │   └── trade-seeder.ts    # Seeds historical orders/trades/positions
    └── reporting/
        └── report.ts          # Metrics computation + CLI formatting

test/
├── core/                      # Existing unit tests (bun:test)
│   ├── kelly.test.ts
│   ├── analytics.test.ts
│   └── matcher.test.ts
└── simulation/                # New simulation tests
    ├── simulated-client.test.ts
    ├── generator.test.ts
    └── strategies/            # Per-strategy backtest smoke tests
        ├── cross-arb.test.ts
        ├── market-maker.test.ts
        └── ...
```

### Structure Rationale

- **`src/simulation/` as a sibling to `src/worker/`**: Keeps simulation code entirely outside the Worker bundle. Nothing in `src/simulation/` should be imported by `src/worker/`. This avoids accidental shipping of test harness to production.
- **`exchange/simulated-client.ts` separate from `data/`**: The exchange client is the injection point; the data feed is a dependency of it. Keeping them separate lets you swap data sources (generated vs. captured) without changing the client interface.
- **`engine/simulated-bot.ts`**: Strategies call `(bot as any).recordTrade()` and read `(bot as any).config`. `SimulatedBot` must satisfy both. It is NOT a Durable Object — it uses in-memory SQLite (via `better-sqlite3` in bun context, or `@miniflare/d1` / Wrangler's `D1Database` shim in integration tests).

## Architectural Patterns

### Pattern 1: Interface Substitution (primary integration point)

**What:** `SimulatedExchangeClient` fully implements the `ExchangeClient` interface from `src/worker/core/exchanges/types.ts`. Strategies call `createExchangeClient(env, platform)` — in simulation, the factory is replaced with a version that returns the simulated client instead of the real one.

**When to use:** Always for backtest and paper trading. The factory is the single swap point.

**Trade-offs:** Strategies work exactly as written. No modification to strategy code. The factory function `createExchangeClient` must be replaceable — achieved by passing a custom `env` object where credentials are absent (forcing the factory to fail) OR by providing a patched factory that simulations inject directly.

**Recommended approach:** Create `createSimulatedEnv(feed: MarketDataFeed): Env` that returns an `Env`-shaped object with a custom property `SIMULATED_EXCHANGE_FEED` that the simulated factory checks for. Alternatively (simpler): skip the factory entirely in the simulation runner — `SimulatedBot` passes the `SimulatedExchangeClient` instance directly where strategies expect to call `createExchangeClient`.

The cleanest pattern given the existing code (strategies call `createExchangeClient(env, platform)` directly inside the tick function):

```typescript
// src/simulation/exchange/factory-override.ts
import type { ExchangeClient } from "../../worker/core/exchanges/types";
import type { MarketDataFeed } from "../data/feed";

// A patched Env-like object where the exchange factory returns simulated clients
export function createSimulatedEnv(feed: MarketDataFeed): Env {
  return {
    // No real credentials — simulated factory reads from feed instead
    _simulationFeed: feed,
    // All other env bindings (DB injected separately via SimulatedBot)
  } as unknown as Env;
}

// src/simulation/exchange/simulated-client.ts
export class SimulatedExchangeClient implements ExchangeClient {
  platform: "polymarket" | "kalshi";
  private feed: MarketDataFeed;
  private fills: OrderResult[] = [];

  constructor(platform: "polymarket" | "kalshi", feed: MarketDataFeed) {
    this.platform = platform;
    this.feed = feed;
  }

  async getPrice(id: string) {
    return this.feed.getPrice(id); // advances cursor
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    // Simulate fill at current price with configurable slippage
    const price = await this.getPrice(order.marketId);
    const filledPrice = order.side === "buy"
      ? price.yes * (1 + this.slippage)
      : price.yes * (1 - this.slippage);
    return { orderId: crypto.randomUUID(), status: "filled", filledPrice, filledSize: order.size };
  }

  // ... all other ExchangeClient methods
}
```

However, because strategies call `createExchangeClient(env, platform)` inline inside the tick function body (not injected via constructor), the cleanest override without modifying strategy code is to **patch the module at test time using bun's module mocking** (`mock.module()`), or to make the factory check for a simulation override on `env`.

The recommended concrete approach: add a single check to `createExchangeClient` in the factory:

```typescript
// Extend factory.ts with one check (minimal production impact):
export function createExchangeClient(env: Env, platform: "polymarket" | "kalshi"): ExchangeClient {
  if ((env as any)._simulationFeed) {
    return new SimulatedExchangeClient(platform, (env as any)._simulationFeed);
  }
  // ... existing real client creation
}
```

This is a single-line change to one existing file and enables the entire simulation layer.

### Pattern 2: Cursor-Based Market Data Feed (no lookahead bias)

**What:** `MarketDataFeed` holds an ordered array of `PriceTick[]` keyed by market ID and indexed by simulation time. `getPrice(marketId)` returns the tick at or before `clock.now()` and never returns future data.

**When to use:** Required for all backtest scenarios. Paper trading uses a live-feed variant that calls the real exchange client for prices.

**Trade-offs:** Generated data must be pre-allocated as an array before the simulation starts (avoids lazy-generation complexity). Memory use is bounded by scenario duration × number of markets × tick frequency. For 8 bots × 50 markets × 1000 ticks this is trivial.

```typescript
// src/simulation/data/feed.ts
export interface PriceTick {
  marketId: string;   // platformId, matches ExchangeClient.getPrice() arg
  timestamp: string;  // ISO-8601
  yes: number;
  no: number;
}

export class MarketDataFeed {
  private ticks: Map<string, PriceTick[]>; // marketId → sorted by timestamp
  private clock: BacktestClock;

  getPrice(marketId: string): { yes: number; no: number } {
    const series = this.ticks.get(marketId) ?? [];
    const now = this.clock.now();
    // Binary search for last tick <= now (no lookahead)
    const tick = lastTickBefore(series, now);
    return { yes: tick?.yes ?? 0.5, no: tick?.no ?? 0.5 };
  }
}
```

### Pattern 3: Scenario-Driven Generator (deterministic, reproducible)

**What:** `MarketDataGenerator` takes a `ScenarioConfig` (type, duration, numMarkets, seed) and outputs `PriceTick[]` arrays. Uses a seeded PRNG so the same config always produces the same data.

**When to use:** For seeder and unit tests. Captured real data is preferred for integration tests.

**Trade-offs:** Generated data cannot reproduce cross-platform arb spreads accurately (deferred as out of scope). For directional strategies (bull/bear/flat/volatile/crash), generated data is sufficient and far simpler than capture/replay.

```typescript
// src/simulation/data/generator.ts
export type ScenarioType = "bull" | "bear" | "flat" | "volatile" | "crash";

export interface ScenarioConfig {
  type: ScenarioType;
  numMarkets: number;
  numTicks: number;
  tickIntervalMs: number;
  startPrice?: number; // default 0.5
  seed?: number;       // for reproducibility
}

export function generateScenario(config: ScenarioConfig): PriceTick[][] {
  // Returns one PriceTick[] per market
}
```

### Pattern 4: SimulatedBot — Minimal BaseBotDO Substitute

**What:** `SimulatedBot` provides the interface that strategies expect from `BaseBotDO` (accessed via `(bot as any).config`, `(bot as any).recordTrade()`) but is a plain class backed by an in-memory SQLite database, not a Durable Object.

**When to use:** In both unit tests (in-memory SQLite via `better-sqlite3`) and integration tests (Wrangler D1 local). This is the only place in the simulation that touches the database.

**Trade-offs:** Strategies cast `bot` to `any` to access `config` and `recordTrade()`. `SimulatedBot` must exactly match those property names. Any refactor of `BaseBotDO` that renames these members breaks `SimulatedBot`.

```typescript
// src/simulation/engine/simulated-bot.ts
export class SimulatedBot {
  // Strategies access these via (bot as any).config / (bot as any).recordTrade
  config: BotConfig;
  private db: Database; // in-memory drizzle instance

  async recordTrade(trade: TradeRecord): Promise<number> {
    // Delegates to same Drizzle insert logic as BaseBotDO
    // Can be a direct copy or extracted shared utility
  }
}
```

The `recordTrade` logic in `BaseBotDO` should be extracted into a standalone `insertTradeRecord(db, config, trade)` function shared between `BaseBotDO` and `SimulatedBot`. This is the recommended refactor (minimal, one file).

## Data Flow

### Backtest Flow

```
CLI args (strategy, scenario, ticks)
    ↓
MarketDataGenerator → PriceTick[][] (pre-generated, scenario-keyed)
    ↓
MarketSeeder.seed(db, ticks) → populates markets + prices tables
    ↓
BacktestClock.init(startTime)
    ↓
[for each tick in scenario]
    BacktestClock.advance(tickIntervalMs)
    SimulatedExchangeClient.getPrice() → reads from MarketDataFeed at clock.now()
    StrategyTickFn(SimulatedBot, simulatedEnv) → strategy executes
    SimulatedExchangeClient.placeOrder() → synthetic fill, no real order
    SimulatedBot.recordTrade() → inserts into in-memory DB
    ↓
ReportGenerator.compute(db) → reads orders/trades/positions
    ↓
CLI output: PnL, Sharpe, drawdown, win rate per strategy per scenario
```

### Paper Trading Flow

```
CLI args (strategy, duration)
    ↓
PaperTrader.start()
    ↓
[real-time loop, configurable interval]
    RealExchangeClient.getPrice() → live prices (read-only, no orders placed)
    Prices fed into MarketDataFeed.record() at real wall-clock time
    StrategyTickFn(SimulatedBot, simulatedEnv) → strategy executes
    SimulatedExchangeClient.placeOrder() → fill simulated at live price
    SimulatedBot.recordTrade() → inserts into local D1 DB
    ↓
ReportGenerator.compute(db) → cumulative metrics after run ends
```

### Seeder Flow

```
CLI args (--seed or --seed-all)
    ↓
BotConfigFactory.forType(botType) → BotConfig for each of 8 types
    ↓
MarketSeeder.seed(db, scenario: "flat") → inserts markets + price history
    ↓
TradeHistorySeeder.seed(db, botId, scenario) → inserts orders/trades/positions
    ↓
DB ready for dashboard inspection or integration test setup
```

### Key Data Flows Summary

1. **Price data into strategies:** `MarketDataFeed` → `SimulatedExchangeClient.getPrice()` → strategy tick body
2. **Trade recording:** `StrategyTickFn` calls `SimulatedExchangeClient.placeOrder()` which returns a synthetic `OrderResult`, then calls `(bot as any).recordTrade()` → in-memory SQLite
3. **Metrics extraction:** `ReportGenerator` reads `trades`, `positions`, `bot_metrics` tables from the simulation DB after all ticks complete — same Drizzle schema, no new tables needed
4. **No production code paths modified** except the single factory extension in `createExchangeClient`

## Suggested Build Order (dependency graph)

Each item can only be built after its dependencies are complete.

```
Phase 1: Foundation
├── BacktestClock                   (no deps)
├── MarketDataFeed                  (dep: BacktestClock)
├── MarketDataGenerator             (dep: MarketDataFeed shape)
└── In-memory DB setup (better-sqlite3 + drizzle + existing schema)

Phase 2: Exchange Simulation
├── SimulatedExchangeClient         (dep: MarketDataFeed, ExchangeClient interface)
└── Factory extension (1 line)     (dep: SimulatedExchangeClient)

Phase 3: Bot Simulation
└── SimulatedBot                    (dep: in-memory DB, BotConfig types, recordTrade logic)
    └── Requires: extract shared recordTrade() from BaseBotDO first

Phase 4: Backtest Engine
└── BacktestEngine                  (dep: all Phase 1-3 components)
    ├── Wires: SimulatedBot + SimulatedExchangeClient + MarketDataFeed
    └── Runs: StrategyTickFn tick loop

Phase 5: Seeder
├── BotConfigFactory                (dep: existing BotConfig types for each strategy)
├── MarketSeeder                    (dep: in-memory DB + MarketDataGenerator)
└── TradeHistorySeeder              (dep: MarketSeeder, SimulatedBot.recordTrade)

Phase 6: Reporting + CLI
├── ReportGenerator                 (dep: in-memory DB + analytics functions already exist)
└── CLI runner                      (dep: everything)

Phase 7: Paper Trading
└── PaperTrader                     (dep: BacktestEngine, real ExchangeClient for price reads)

Phase 8: Tests
├── Unit: simulated-client, generator, clock (dep: Phase 1-2)
├── Unit: strategy smoke tests per strategy (dep: Phase 3-4)
└── Integration: Wrangler D1 local (dep: all, requires wrangler dev running)
```

## Anti-Patterns

### Anti-Pattern 1: Modifying Strategy Code for Testability

**What people do:** Add conditional branches inside strategy tick functions (`if (env.SIMULATION_MODE) { ... }`) or accept injected exchange clients via a new parameter.

**Why it's wrong:** Violates the requirement that simulation exercises strategies through their existing `StrategyTickFn` interface without modification. Creates divergence between tested code and production code.

**Do this instead:** Inject the simulated client via the `env` object through the factory extension. Strategies never know they're in simulation.

### Anti-Pattern 2: Vectorised (non-event-driven) Backtest

**What people do:** Pre-compute all strategy decisions across the entire price series at once using array operations, then calculate PnL from the decision array.

**Why it's wrong:** Bypasses the actual strategy code. Can't detect bugs where strategies look ahead, use stale data, or have side effects on the DB. The whole value of this backtest layer is running the real strategy code.

**Do this instead:** Tick-by-tick event-driven replay. Advance the clock one tick at a time and call the actual `StrategyTickFn`. Slower (O(n) strategy calls) but exercises real code paths.

### Anti-Pattern 3: Sharing DB State Across Simulations

**What people do:** Run multiple strategy simulations sequentially using the same in-memory DB instance.

**Why it's wrong:** Positions and trades from one strategy leak into the next. Risk checks (`PortfolioRisk.isDailyLossBreached()`) read stale state. Results are not independent.

**Do this instead:** Create a fresh in-memory SQLite DB per simulation run. The schema is small; re-initialisation is fast. Each strategy × scenario pair gets an isolated DB.

### Anti-Pattern 4: Using Durable Object APIs in Simulation

**What people do:** Try to instantiate `BotDO` directly in tests, triggering Cloudflare-specific imports (`cloudflare:workers`, `DurableObject`).

**Why it's wrong:** `DurableObject` is not available outside the Workers runtime. Tests will fail immediately when run with `bun test`.

**Do this instead:** `SimulatedBot` is a plain TypeScript class that implements the same duck-typed interface strategies use (`config`, `recordTrade()`). It never extends `DurableObject`.

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `simulation/` → `worker/core/exchanges/types.ts` | TypeScript import (read-only) | `SimulatedExchangeClient` implements this interface |
| `simulation/` → `worker/core/db/schema.ts` | TypeScript import (read-only) | `SimulatedBot` uses same schema for in-memory DB |
| `simulation/` → `worker/core/risk/` | TypeScript import (read-only) | `PortfolioRisk` is instantiated with a sim DB handle |
| `simulation/` → `worker/bots/registry.ts` | TypeScript import (read-only) | `BacktestEngine` calls `getStrategy(botType)` |
| `simulation/` → `worker/bots/base.ts` | TypeScript import (types only) | `BotConfig`, `TradeRecord` types |
| `worker/core/exchanges/factory.ts` | One-line extension | Single production file modified — adds sim check |

### External Services

| Service | Simulation Behaviour | Notes |
|---------|---------------------|-------|
| Polymarket REST API | Not called in backtest; called read-only in paper trading for prices | `placeOrder` never reaches real exchange |
| Kalshi REST API | Same as above | |
| Cloudflare D1 | In-memory SQLite in unit tests; Wrangler D1 local in integration tests | No remote D1 ever used for simulation |
| Cloudflare Workers runtime | Not used in simulation context | `SimulatedBot` is a plain class |

## Scaling Considerations

This is a dev/test tool, not a production service. Scaling is not a concern. The relevant capacity questions are:

| Concern | Answer |
|---------|--------|
| Scenario data volume | 8 bots × 50 markets × 1000 ticks × ~100 bytes = ~40MB RAM per run — trivial |
| Test parallelism | Each test creates its own in-memory DB; bun:test parallel workers safe |
| Integration test speed | Wrangler D1 local startup is ~2-3s; keep integration test count small (smoke tests only) |
| Real-data capture size | Parquet/JSON replay files for 30 days Polymarket/Kalshi data are ~50-200MB per market; store in `.simulation-data/` gitignored |

## Sources

- [barter-rs: mock MarketStream/Execution for near-identical live/backtest systems](https://github.com/barter-rs/barter-rs) — confirms interface-substitution pattern
- [NautilusTrader: same execution semantics for research and live](https://nautilustrader.io/) — confirms event-driven tick-by-tick approach
- [prediction-market-backtesting: Kalshi/Polymarket engine inspired by NautilusTrader](https://github.com/evan-kolberg/prediction-market-backtesting) — confirms chronological replay approach for prediction markets
- [QuantStart: event-driven backtesting Python Part I](https://www.quantstart.com/articles/Event-Driven-Backtesting-with-Python-Part-I/) — DataHandler abstract base pattern
- [Existing codebase analysis: `src/worker/core/exchanges/types.ts`, `src/worker/bots/base.ts`, `src/worker/bots/registry.ts`] — interface definitions sourced directly

---
*Architecture research for: Trading bot simulation/backtest layer*
*Researched: 2026-03-21*
