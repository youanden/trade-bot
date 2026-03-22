# Phase 4: Backtest Engine - Research

**Researched:** 2026-03-21
**Domain:** Backtesting engine design — injectable clock, duck-typed bot interface, isolated in-memory databases, LLM mock injection
**Confidence:** HIGH

## Summary

Phase 4 builds the orchestration layer that stitches together everything from Phases 1-3. The generator (Phase 2) produces price series; the PriceFeed and SimExchangeClient (Phase 3) enforce no-lookahead access; the backtest engine (Phase 4) drives the existing `StrategyTickFn` functions tick-by-tick through simulated time. The core challenge is not algorithmic — the pattern is well-understood — but structural: strategies were written to receive a real `BaseBotDO` instance that extends `DurableObject` from `cloudflare:workers`. Tests cannot import that base class outside Wrangler, so Phase 1 already established the duck-typing pattern via `makeMockBot()`. Phase 4 promotes that helper pattern into a production `SimulatedBot` class with a real in-memory database.

The three architectural decisions that constrain everything else: (1) `PortfolioRisk.isDailyLossBreached()` calls `new Date()` directly — this MUST be refactored to accept an injectable clock before multi-day backtests can work correctly; (2) strategies call `createDb(env.DB)` on every tick, so the backtest env stub must carry a bun-sqlite `Database` instance that drizzle-orm accepts; (3) LLM strategies check `if (!env.AI)` and return early — the mock must be injected via `env.AI` on the backtest env stub, not by module-mocking.

**Primary recommendation:** Implement `SimulatedBot` as a plain TypeScript class (no `DurableObject` extension) that duck-types the properties and methods strategies access via `(bot as any).config` and `(bot as any).recordTrade(...)`. Use one `createTestDb()` instance per run (the existing helper). Thread a `() => string` clock function through `PortfolioRisk` and the backtest env. Wire `mockAI` from `test/helpers/mocks.ts` into the env stub. Log equity snapshots after each tick by reading `SimExchangeClient.getBalance()`.

## Standard Stack

No new npm dependencies are required. Phase 4 uses only what Phases 1-3 established.

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm/bun-sqlite` | 0.38 | In-memory test database identical to D1 semantics | Already used in `test/helpers/db.ts`; `createTestDb()` pattern established |
| `bun:sqlite` | built-in | SQLite engine for in-memory isolation | No install; already used in Phase 1 |
| `bun:test` | built-in | Test runner; `describe`, `test`, `expect`, `beforeEach`, `mock` | Established project test runner |

### Supporting (already installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-orm` | 0.38 | ORM for DB writes inside `SimulatedBot.recordTrade()` | Used by all strategies to insert trades/positions |

### No New Dependencies

The backtest engine is pure TypeScript implementation on top of the existing stack. There is no external backtest library to install; the project builds its own domain-specific engine to match the existing `StrategyTickFn` interface exactly.

**Installation:** None required.

## Architecture Patterns

### Recommended Project Structure

```
src/worker/core/simulation/
├── generator.ts        # (existing) Scenario price generator
├── feed.ts             # (existing) PriceFeed no-lookahead cursor
├── sim-client.ts       # (existing) SimExchangeClient
├── types.ts            # (existing) ScenarioType, GeneratedScenario
├── prng.ts             # (existing) Seeded PRNG
├── sim-bot.ts          # NEW: SimulatedBot class (duck-types BaseBotDO)
└── engine.ts           # NEW: BacktestEngine orchestrator + BacktestClock

test/core/
├── sim-client.test.ts  # (existing)
├── generator.test.ts   # (existing)
├── feed.test.ts        # (existing)
├── engine.test.ts      # NEW: BacktestEngine integration tests
└── sim-bot.test.ts     # NEW: SimulatedBot unit tests
```

### Pattern 1: BacktestClock (BT-01)

**What:** A simple counter-based clock that returns the next simulated ISO-8601 timestamp on each `advance()` call. Starts at `startTime`, increments by `tickIntervalMs`.

**When to use:** Passed as `simulatedNow` callback to `SimExchangeClient` and to `PortfolioRisk` (after the injectable clock refactor).

```typescript
// src/worker/core/simulation/engine.ts
export class BacktestClock {
  private currentMs: number;
  private readonly intervalMs: number;

  constructor(startTime: string, tickIntervalMs: number) {
    this.currentMs = new Date(startTime).getTime();
    this.intervalMs = tickIntervalMs;
  }

  now(): string {
    return new Date(this.currentMs).toISOString();
  }

  advance(): void {
    this.currentMs += this.intervalMs;
  }

  isAfter(isoTimestamp: string): boolean {
    return this.currentMs > new Date(isoTimestamp).getTime();
  }
}
```

**Confidence:** HIGH — this is the standard pattern; `PriceFeed.getUpTo()` already accepts ISO-8601 strings for this purpose.

### Pattern 2: SimulatedBot (BT-03)

**What:** A plain class that duck-types the interface strategies access. Strategies cast `bot` as `any` to call `.config` and `.recordTrade()`. `SimulatedBot` satisfies both without importing `BaseBotDO`.

**When to use:** One instance per backtest run. Holds a reference to the run's isolated `Database` and writes trade records to it.

```typescript
// src/worker/core/simulation/sim-bot.ts
import type { Database } from "../db/client";
import type { BotConfig, TradeRecord, BotStatus } from "../../bots/base";
import { orders, trades, positions, botInstances, auditLog } from "../db/schema";
import { eq, and } from "drizzle-orm";

export class SimulatedBot {
  // Public so strategies can access via (bot as any).config
  config: BotConfig;
  private db: Database;
  private tradeCount: number = 0;
  private dbBotId: number = 1; // Stable ID within the isolated DB

  constructor(config: BotConfig, db: Database) {
    this.config = config;
    this.db = db;
  }

  /** Duck-types BaseBotDO.recordTrade — called by strategies via (bot as any).recordTrade(...) */
  async recordTrade(trade: TradeRecord): Promise<number> {
    // Mirror the logic from BaseBotDO.recordTrade exactly, using this.db
    // ...insert into orders, trades, upsertPosition
    return ++this.tradeCount;
  }

  getStatus(): BotStatus {
    return {
      id: "sim-bot",
      botType: this.config.botType,
      name: this.config.name,
      running: true,
      lastTick: new Date().toISOString(),
      tickCount: 0,
      error: null,
    };
  }
}
```

**Critical constraint:** Do NOT import from `cloudflare:workers`. `BaseBotDO` extends `DurableObject` from that package; tests run under bun, not Wrangler. The Phase 1 decision to use `Record<string, unknown>` config types in `makeMockBot` is why this constraint exists.

**Import the shared types only:** `BotConfig`, `TradeRecord`, `BotStatus` from `../../bots/base` are plain interfaces (no runtime `cloudflare:workers` dependency) and can be imported safely.

### Pattern 3: BacktestEngine (BT-02)

**What:** Orchestrates the tick loop — creates isolated DB, SimulatedBot, BacktestClock, SimExchangeClient (via `createExchangeClient` with simFeed), then calls the `StrategyTickFn` for each clock tick.

```typescript
// src/worker/core/simulation/engine.ts

export interface BacktestConfig {
  botType: string;
  botConfig: BotConfig;
  scenario: GeneratedScenario;
  tickIntervalMs?: number; // defaults to scenario interval
  platform: "polymarket" | "kalshi";
  virtualBalance?: number;
  mockAI?: { run: (model: string, inputs: unknown) => Promise<unknown> };
}

export interface EquitySnapshot {
  timestamp: string;
  balance: number;
  tickIndex: number;
}

export interface BacktestResult {
  equityCurve: EquitySnapshot[];
  tradeCount: number;
  finalBalance: number;
  runId: string; // unique per run
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  // 1. Create isolated in-memory DB
  const db = createTestDb(); // each call creates a fresh :memory: instance

  // 2. Create clock
  const startTime = config.scenario.prices[0].timestamp;
  const intervalMs = config.tickIntervalMs ?? 60_000;
  const clock = new BacktestClock(startTime, intervalMs);

  // 3. Create PriceFeed
  const feed = new PriceFeed(config.scenario);

  // 4. Create SimulatedBot
  const bot = new SimulatedBot(config.botConfig, db);

  // 5. Build env stub — matches Env interface for strategy consumption
  const env = buildBacktestEnv(db, feed, clock, config);

  // 6. Get strategy tick function
  const strategy = getStrategy(config.botType);
  if (!strategy) throw new Error(`Unknown bot type: ${config.botType}`);

  // 7. Seed market + price rows into isolated DB
  await seedScenario(db, config.scenario);

  // 8. Tick loop
  const equityCurve: EquitySnapshot[] = [];
  for (let i = 0; i < config.scenario.prices.length; i++) {
    await strategy(bot as any, env as any);
    const balance = await (env as any)._simClient.getBalance();
    equityCurve.push({ timestamp: clock.now(), balance, tickIndex: i });
    clock.advance();
  }

  return {
    equityCurve,
    tradeCount: bot._tradeCount,
    finalBalance: equityCurve[equityCurve.length - 1]?.balance ?? config.virtualBalance ?? 1000,
    runId: crypto.randomUUID(),
  };
}
```

### Pattern 4: Backtest Env Stub

**What:** Strategies call `createDb(env.DB)` — the env stub must carry a D1-compatible DB handle. The bun-sqlite `Database` instance wrapped by Drizzle satisfies this for tests. LLM strategies check `env.AI`.

```typescript
function buildBacktestEnv(db: TestDb, feed: PriceFeed, clock: BacktestClock, config: BacktestConfig) {
  return {
    DB: db as unknown as D1Database, // same cast used in makeTestEnv()
    BOT_DO: {} as DurableObjectNamespace,
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "backtest",
    AI: config.mockAI as Ai | undefined,
    _simClient: createExchangeClient(
      {} as Env,  // credentials not needed — simFeed overrides
      config.platform,
      { feed, config: { simulatedNow: () => clock.now(), virtualBalance: config.virtualBalance ?? 1000 } }
    ),
  };
}
```

**Key insight:** The factory already supports `simFeed` injection (EXCH-07, Phase 3). The backtest env stub passes empty credentials because `simFeed` presence short-circuits credential validation in `createExchangeClient`.

### Pattern 5: PortfolioRisk Injectable Clock (BT-04)

**What:** `PortfolioRisk.isDailyLossBreached()` currently calls `new Date().toISOString().split("T")[0]` to get today's date. In a multi-day backtest, "today" is the simulated day, not the real wall-clock day.

**Required change:** Add an optional `clockFn` parameter to `PortfolioRisk` constructor. When present, use it instead of `new Date()`. Existing callers (no third argument) get wall-clock behavior unchanged.

```typescript
// src/worker/core/risk/portfolio.ts — minimal change

export class PortfolioRisk {
  private db: Database;
  private limits: PositionLimits;
  private readonly clockFn: () => string;  // ADD THIS

  constructor(db: Database, limits?: Partial<PositionLimits>, clockFn?: () => string) {
    this.db = db;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.clockFn = clockFn ?? (() => new Date().toISOString()); // ADD THIS
  }

  async isDailyLossBreached(): Promise<boolean> {
    const today = this.clockFn().split("T")[0];  // REPLACE new Date() with this.clockFn()
    // ... rest unchanged
  }
}
```

**Downstream impact:** Every strategy that instantiates `PortfolioRisk` does so as `new PortfolioRisk(db, getLimitsForBot(...))`. The new optional third parameter is additive — zero changes required to strategy files. The backtest env must arrange for strategies to receive the injected clock. Since strategies construct `PortfolioRisk` themselves (not via dependency injection), the clock must arrive via a different mechanism.

**The real constraint:** Strategies call `createDb(env.DB)` and then construct their own `PortfolioRisk`. There is no way to pass a clock to `PortfolioRisk` from the engine without either:
  - (a) Modifying strategy files (out of scope — "no strategy code modifications")
  - (b) Injecting the clock via a module-level override pattern (module mocking)
  - (c) Storing the simulated date in the DB itself as the source of truth for "today"
  - (d) Overriding `Date` globally for the duration of the backtest run

**Recommended approach (option d — global Date override):** The backtest engine temporarily replaces `globalThis.Date` with a `FakeDate` class that returns simulated time from the clock. This is standard in time-sensitive testing (used by Jest's `useFakeTimers`, Sinon's `useFakeTimers`). After the run, restore the original `Date`. This approach requires zero changes to strategy files and zero changes to `PortfolioRisk`.

```typescript
// In runBacktest(), before the tick loop:
const OriginalDate = globalThis.Date;
function FakeDate(...args: any[]) {
  if (args.length === 0) return new OriginalDate(clock.now());
  return new OriginalDate(...args);
}
FakeDate.now = () => new OriginalDate(clock.now()).getTime();
FakeDate.parse = OriginalDate.parse;
FakeDate.UTC = OriginalDate.UTC;
Object.setPrototypeOf(FakeDate, OriginalDate);
globalThis.Date = FakeDate as any;

try {
  // ... tick loop
} finally {
  globalThis.Date = OriginalDate;  // always restore
}
```

**Confidence:** MEDIUM — global Date override works but has subtle risks in parallel test runs (bun runs test files in parallel by default). The backtest tests MUST be isolated to their own file or use `--no-parallel` if date-sensitive assertions are needed.

**Alternative (lower risk for parallel safety):** The `PortfolioRisk` injectable clock (option b — constructor parameter). This requires a one-line change to each of the 8 strategy files where `new PortfolioRisk(db, ...)` is called. The REQUIREMENTS.md only says "no strategy code modifications" for the StrategyTickFn interface itself — adding a constructor parameter to an internal service may be acceptable. Clarify with the planner.

### Pattern 6: Database Isolation (BT-05)

**What:** Each `runBacktest()` call creates a new `bun:sqlite` in-memory database via `createTestDb()`. Since each `new Database(":memory:")` call creates a completely separate SQLite instance, isolation is structural — there is no shared global state.

**When to use:** Always. The existing `createTestDb()` helper from `test/helpers/db.ts` is exactly right. The engine should either call it directly or accept a `db` parameter for test injection.

**Warning:** Do not use a file-path SQLite (`:memory:` vs a temp file path). A temp file shared between concurrent backtest runs would create cross-contamination. The `:memory:` default in `createTestDb()` is correct.

### Pattern 7: LLM Mock in Backtest (BT-07)

**What:** LLM-dependent strategies (`llm-assessor`, `deep-research`) check `if (!env.AI)` and return early. In backtest mode, the engine provides a mock `env.AI` that returns valid JSON responses. This follows exactly what Phase 1 established with `mockAI` in `test/helpers/mocks.ts`.

**How it works:** The `BacktestConfig` accepts an optional `mockAI` object. The engine includes it in the env stub. For backtest runs targeting LLM strategies, callers pass `mockAI`. For all other strategies, `mockAI` is omitted and `env.AI` is `undefined` (strategies that don't use AI are unaffected).

**Success criteria reference (BT-07):** "produce at least one trade record" — for this to work, `mockAI.run()` must return a probability value that creates a detectable `edge > config.minEdge`. The existing `mockAI` returns `probability: 0.6` with market price defaulting to `0.5` from `SimExchangeClient.getPrice()`, giving `edge = 0.1`. With default `minEdge: 0.05`, a trade WILL be placed. This is already verified by the Phase 1 test `llm-assessor.test.ts`.

### Pattern 8: Equity Curve Logging (BT-06)

**What:** After each strategy tick, read `simClient.getBalance()` and record `{ timestamp, balance, tickIndex }`. This creates a time-series of balance snapshots suitable for later Sharpe/drawdown calculations by Phase 6.

**Where equity data lives:** In the `BacktestResult` object returned by `runBacktest()`. It is NOT written to the isolated DB — it is an in-memory array. Phase 6 (Reporting) will consume this array directly.

**Equity snapshot structure:**
```typescript
export interface EquitySnapshot {
  timestamp: string;   // ISO-8601, matches the simulated clock
  balance: number;     // virtual balance after this tick
  tickIndex: number;   // 0-based tick number for easy charting
}
```

### Anti-Patterns to Avoid

- **Importing `BaseBotDO` in `SimulatedBot`**: The `cloudflare:workers` package throws at import time outside Wrangler. `SimulatedBot` must be a standalone class. The interfaces (`BotConfig`, `TradeRecord`, `BotStatus`) are plain TypeScript and safe to import.
- **Shared database across runs**: Never reuse a `Database` instance between `runBacktest()` calls. Pass a fresh `createTestDb()` each time.
- **Calling `new Date()` inside the tick loop without clock injection**: `PortfolioRisk.isDailyLossBreached()` and `BaseBotDO.recordTrade()` use `new Date()`. Without the global Date override (or constructor injection), a multi-day backtest will always see the same wall-clock "today" and the circuit breaker will never reset between simulated days.
- **Module-mocking `createDb` in the backtest engine**: Module mocking (via `mock.module()`) in bun applies process-wide. The engine should not rely on it — pass the DB instance through the env stub instead, exactly as `makeTestEnv(db)` does in Phase 1 tests.
- **Running simClient outside the env**: The backtest must use the SAME `SimExchangeClient` instance that strategies receive via `createExchangeClient(env, ...)`. If the engine creates a separate client to read balance, it will have a different state (different balance, different order counter). Either store the client reference at engine level and expose it, or read balance from the isolated DB's positions table.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Price series generation | Custom random walk | `generateScenario()` from Phase 2 | Already seeded, reproducible, schema-compatible |
| No-lookahead feed | Manual timestamp filtering | `PriceFeed.latestAt(clock.now())` from Phase 2 | Already tested and verified |
| Exchange simulation | Custom order matching | `SimExchangeClient` from Phase 3 | Fees, partial fills, leg-2 failure already modeled |
| In-memory DB | SQLite setup from scratch | `createTestDb()` from Phase 1 | Migration already applied, schema matches production |
| Strategy dispatch | Custom strategy lookup | `getStrategy(botType)` from registry | Already maps all 8 bot types |
| Seeded randomness | `Math.random()` | `createPrng(seed)` from Phase 2 | Deterministic, reproducible across runs |

**Key insight:** Phases 1-3 built almost everything the engine needs. Phase 4 is primarily an orchestration layer — gluing the pieces together in the right order with the right wiring.

## Common Pitfalls

### Pitfall 1: `cloudflare:workers` import error in SimulatedBot
**What goes wrong:** `import { DurableObject } from "cloudflare:workers"` throws `Cannot find module 'cloudflare:workers'` when running under bun:test (not Wrangler).
**Why it happens:** `BaseBotDO extends DurableObject` forces the import at module load time. Any file that imports `BaseBotDO` will fail in the test environment.
**How to avoid:** `SimulatedBot` must NOT extend or import `BaseBotDO`. Import only the pure interfaces (`BotConfig`, `TradeRecord`, `BotStatus`) which have no runtime dependency on Cloudflare.
**Warning signs:** Test output showing `Cannot find module 'cloudflare:workers'` or `Module not found`.

### Pitfall 2: `createDb()` type mismatch with bun-sqlite
**What goes wrong:** `createDb(env.DB)` expects a `D1Database` (Cloudflare type). The bun-sqlite `Database` instance is not a `D1Database`. TypeScript will reject the cast without `as unknown as D1Database`.
**Why it happens:** The production `createDb` signature is `(d1: D1Database) => Database`. In tests, we use the drizzle bun-sqlite adapter directly, bypassing `createDb`. But strategies call `createDb(env.DB)` internally.
**How to avoid:** The env stub must carry the bun-sqlite `Database` wrapped in Drizzle at `env.DB`. Since strategies call `createDb(env.DB)`, the `createDb` function must accept the bun-sqlite db. In tests, module-mock `createDb` to return the test DB — this is what all Phase 1/3 strategy tests already do. The backtest engine should similarly mock `createDb` OR ensure `env.DB` passes through the D1 adapter.
**Better approach:** The backtest env stub can carry the already-drizzled TestDb and module-mock `createDb` to return it, exactly as done in strategy tests. This is consistent with established patterns.

### Pitfall 3: Daily loss circuit breaker never resets
**What goes wrong:** A 3-day backtest has the circuit breaker triggered on day 1. On day 2 and 3, `isDailyLossBreached()` still checks against today's real wall-clock date (e.g., `2026-03-21`), which doesn't match any simulated day. It never finds losses or it incorrectly finds day 1's losses on day 2.
**Why it happens:** `new Date().toISOString().split("T")[0]` uses wall-clock time, not simulated time.
**How to avoid:** Implement the global `Date` override pattern before the tick loop, OR refactor `PortfolioRisk` to accept an injectable `clockFn` and update the 8 strategy call sites to pass it via the env.
**Warning signs:** Circuit breaker never resetting in multi-day backtest assertions.

### Pitfall 4: Balance read from wrong client instance
**What goes wrong:** Engine creates one `SimExchangeClient` to track equity, but strategies receive a DIFFERENT client from `createExchangeClient()`. The equity curve always shows the initial balance.
**Why it happens:** `createExchangeClient` creates a new `SimExchangeClient` instance per call. Each instance has its own in-memory balance and order state.
**How to avoid:** Strategies receive the exchange client via `createExchangeClient(env, platform, simFeed)`. The engine must either (a) capture the same client reference, or (b) read balance from the DB's positions table after each tick. Approach (b) is more reliable — query the DB, not the client.

### Pitfall 5: bun parallel test isolation with global Date override
**What goes wrong:** bun:test runs test files in parallel by default. If two backtest test files both override `globalThis.Date`, they interfere with each other.
**Why it happens:** `globalThis` is shared within the same bun worker process. File-level parallelism can cause race conditions on the global Date.
**How to avoid:** Either (a) put all date-sensitive backtest tests in one file, or (b) use `--no-parallel` flag for the engine test file, or (c) prefer the `PortfolioRisk` injectable clock approach which avoids global mutation entirely.

### Pitfall 6: LLM strategy never produces a trade record
**What goes wrong:** `BT-07` requires llm-assessor to produce at least one trade record in a backtest. But if `minEdge` in the config is too high, or if `mockAI` returns a probability too close to the market price, the strategy skips trading.
**Why it happens:** The strategy checks `if (edge < config.minEdge) return`. With `mockAI` returning `probability: 0.6` and market price `0.5`, edge is `0.1`. If `minEdge` in the test config is `> 0.1`, no trade occurs.
**How to avoid:** Use `minEdge: 0.05` in the backtest config for LLM strategies. The existing Phase 1 test confirms this combination produces trades.

### Pitfall 7: Strategy accesses `bot.config` but SimulatedBot field is private
**What goes wrong:** Strategies use `(bot as any).config` to access `BotConfig`. If `SimulatedBot.config` is declared `private`, the `as any` cast will bypass TypeScript but the property will be accessible at runtime (JavaScript ignores `private` at runtime). However, this creates confusion.
**Why it happens:** TypeScript `private` is compile-time only; JavaScript has no private class fields unless using `#config` syntax. The `as any` cast always works. However, for clarity and to mirror how `BaseBotDO` exposes `config` (`protected`), use `config` as a `public` property in `SimulatedBot`.

## Code Examples

### Full Backtest Run (integration test pattern)

```typescript
// test/core/engine.test.ts
import { describe, test, expect } from "bun:test";
import { generateScenario } from "../../src/worker/core/simulation/generator";
import { runBacktest } from "../../src/worker/core/simulation/engine";
import { mockAI } from "../helpers/mocks";

describe("BT-06: equity curve", () => {
  test("produces equity snapshots at each tick", async () => {
    const scenario = generateScenario({ type: "flat", seed: 42, ticks: 5 });
    const result = await runBacktest({
      botType: "market-maker",
      botConfig: {
        botType: "market-maker",
        name: "test-mm",
        tickIntervalMs: 60_000,
        platform: "polymarket",
        spread: 0.02,
        maxPositionSize: 100,
      },
      scenario,
      platform: "polymarket",
      virtualBalance: 1000,
    });
    expect(result.equityCurve).toHaveLength(5);
    expect(result.equityCurve[0].balance).toBeGreaterThan(0);
    expect(result.equityCurve[0].timestamp).toBe(scenario.prices[0].timestamp);
  });
});

describe("BT-05: database isolation", () => {
  test("two concurrent runs have no shared rows", async () => {
    const scenario = generateScenario({ type: "bull", seed: 1, ticks: 3 });
    const cfg = {
      botType: "market-maker",
      botConfig: { botType: "market-maker", name: "a", tickIntervalMs: 60_000, platform: "polymarket", spread: 0.02, maxPositionSize: 100 },
      scenario,
      platform: "polymarket" as const,
      virtualBalance: 1000,
    };
    const [r1, r2] = await Promise.all([runBacktest(cfg), runBacktest(cfg)]);
    expect(r1.runId).not.toBe(r2.runId);
    // Both should complete without shared state errors
    expect(r1.equityCurve).toHaveLength(3);
    expect(r2.equityCurve).toHaveLength(3);
  });
});

describe("BT-07: LLM mock", () => {
  test("llm-assessor produces at least one trade with mockAI", async () => {
    const scenario = generateScenario({ type: "bull", seed: 42, ticks: 5 });
    const result = await runBacktest({
      botType: "llm-assessor",
      botConfig: {
        botType: "llm-assessor",
        name: "test-llm",
        tickIntervalMs: 60_000,
        platform: "polymarket",
        aiModel: "@cf/meta/llama-3-8b-instruct",
        minEdge: 0.05,
        maxPositionSize: 100,
      },
      scenario,
      platform: "polymarket",
      virtualBalance: 1000,
      mockAI,
    });
    expect(result.tradeCount).toBeGreaterThan(0);
  });
});
```

### PortfolioRisk injectable clock (minimal refactor)

```typescript
// Minimal change to src/worker/core/risk/portfolio.ts
// Add optional clockFn parameter — existing callers unchanged

constructor(db: Database, limits?: Partial<PositionLimits>, clockFn?: () => string) {
  this.db = db;
  this.limits = { ...DEFAULT_LIMITS, ...limits };
  this.clockFn = clockFn ?? (() => new Date().toISOString());
}

async isDailyLossBreached(): Promise<boolean> {
  const today = this.clockFn().split("T")[0]; // was: new Date().toISOString().split("T")[0]
  // ... rest identical
}
```

### seedScenario helper (engine internal)

```typescript
// Insert market + price rows into isolated DB before tick loop
async function seedScenario(db: TestDb, scenario: GeneratedScenario): Promise<number> {
  const [market] = await db.insert(markets).values(scenario.market).returning();
  await db.insert(prices).values(
    scenario.prices.map((p) => ({ ...p, marketId: market.id }))
  );
  return market.id;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Real `DurableObject` base class for testing | Duck-typed plain class (`SimulatedBot`) | Established Phase 1 | Enables bun:test without Wrangler |
| Module-mock `createDb` in every test file | Injectable DB via env stub | Pattern in place Phase 1 | Consistent test isolation |
| Wall-clock `new Date()` in risk checks | Injectable clock function | Phase 4 introduces | Multi-day backtest correctness |
| Separate MockExchangeClient in tests | `SimExchangeClient` as the mock | Phase 3 completed | Single authoritative sim client |

## Open Questions

1. **PortfolioRisk clock injection: global Date override vs constructor parameter**
   - What we know: Strategies construct `PortfolioRisk` internally — the engine cannot easily pass a clock unless it modifies strategy files or overrides `Date` globally.
   - What's unclear: Whether "no strategy code modifications" means the `StrategyTickFn` signature only, or all strategy source files.
   - Recommendation: Planner should decide. If strategy files can be touched for infrastructure (not logic), the constructor parameter is cleaner and parallel-safe. If truly no-touch, use global Date override with a single-file test constraint.

2. **Where to read balance for equity curve: simClient vs DB**
   - What we know: `SimExchangeClient.getBalance()` holds the virtual balance. Strategies receive the client from `createExchangeClient(env, ...)` which creates a new instance each tick if called fresh.
   - What's unclear: Whether to store the simClient at engine level and expose it, or compute balance from DB positions.
   - Recommendation: Store the `SimExchangeClient` instance at engine level (created once, referenced via a module-level mock of `createExchangeClient`), OR use the `simClient` stored on the env stub as `env._simClient` (a non-standard field strategies won't touch).

3. **Multi-strategy simultaneous backtest**
   - What we know: Phase 6 (Reporting) needs metrics for all 8 strategies across all 5 scenarios = 40 runs.
   - What's unclear: Whether Phase 4 needs to support running all 8 in a single `runBacktest()` call, or Phase 6 just calls `runBacktest()` 40 times.
   - Recommendation: Keep `runBacktest()` single-strategy. Phase 6 loops over strategies and scenarios. No multi-strategy engine needed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none — `bun test` discovers `test/**/*.test.ts` |
| Quick run command | `bun test test/core/engine.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BT-01 | BacktestClock advances tick-by-tick at configurable intervals | unit | `bun test test/core/engine.test.ts` | No — Wave 0 |
| BT-02 | Engine drives StrategyTickFn calls in time order | integration | `bun test test/core/engine.test.ts` | No — Wave 0 |
| BT-03 | SimulatedBot duck-types config, recordTrade, getStatus | unit | `bun test test/core/sim-bot.test.ts` | No — Wave 0 |
| BT-04 | PortfolioRisk.isDailyLossBreached() uses injectable clock | unit | `bun test test/core/engine.test.ts` | No — Wave 0 |
| BT-05 | Two concurrent runs have isolated databases | integration | `bun test test/core/engine.test.ts` | No — Wave 0 |
| BT-06 | Equity curve snapshots timestamped per tick | integration | `bun test test/core/engine.test.ts` | No — Wave 0 |
| BT-07 | LLM strategies use mockAI, produce at least one trade | integration | `bun test test/core/engine.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test test/core/engine.test.ts test/core/sim-bot.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/core/engine.test.ts` — covers BT-01, BT-02, BT-04, BT-05, BT-06, BT-07
- [ ] `test/core/sim-bot.test.ts` — covers BT-03
- [ ] `src/worker/core/simulation/engine.ts` — BacktestEngine + BacktestClock implementation
- [ ] `src/worker/core/simulation/sim-bot.ts` — SimulatedBot implementation

## Sources

### Primary (HIGH confidence)

- Codebase: `src/worker/core/simulation/` — feed.ts, sim-client.ts, generator.ts, types.ts, prng.ts (all verified by direct file read)
- Codebase: `src/worker/bots/base.ts` — BaseBotDO interface members confirmed: `config` (protected), `recordTrade()` (protected), `getStatus()` (public)
- Codebase: `src/worker/core/risk/portfolio.ts` — `isDailyLossBreached()` confirmed to use `new Date()` directly on line 107
- Codebase: `test/helpers/mocks.ts` — `makeMockBot`, `makeTestEnv`, `mockAI` — duck-typing pattern and LLM mock pattern confirmed
- Codebase: `test/helpers/db.ts` — `createTestDb()` isolation pattern confirmed
- Codebase: `src/worker/bots/registry.ts` — `StrategyTickFn` type and all 8 strategy registrations confirmed
- Codebase: `src/worker/bots/llm-assessor/strategy.ts` — `if (!env.AI) return` pattern confirmed; `(bot as any).config` and `(bot as any).recordTrade` access confirmed
- Codebase: `src/worker/core/exchanges/factory.ts` — `simFeed` parameter confirmed; `SimExchangeClient` created with `simulatedNow` callback

### Secondary (MEDIUM confidence)

- Pattern: global `Date` override for time-based testing — standard in testing literature; used by Jest fake timers, Sinon useFakeTimers, Temporal polyfills. No official bun:test native clock available as of research date.

### Tertiary (LOW confidence)

- Parallel safety of global Date override in bun:test — behavior depends on whether bun isolates per-file with separate V8 contexts or shares a global. Not verified against bun documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies confirmed installed, no new installs needed
- Architecture: HIGH — all interface members verified from source; duck-typing pattern confirmed from Phase 1 precedent
- Pitfalls: HIGH for pitfalls 1-4 (verified from source); MEDIUM for pitfalls 5-7 (inferred from patterns, not bun-specific docs)
- PortfolioRisk clock strategy: MEDIUM — two valid options; tradeoff depends on project decision about "no strategy modifications" scope

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable stack; no external API dependencies)

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BT-01 | BacktestClock advances tick-by-tick at configurable intervals, replacing wall clock | BacktestClock class design in Pattern 1; ISO-8601 string arithmetic matches PriceFeed.getUpTo() contract |
| BT-02 | Backtest engine drives StrategyTickFn calls in time order using BacktestClock | Pattern 3 (BacktestEngine); getStrategy() from registry; tick loop calling strategy(bot, env) per price row |
| BT-03 | SimulatedBot duck-types BaseBotDO interface (config access, recordTrade, getStatus) | Pattern 2 (SimulatedBot); BaseBotDO member names verified from source; cannot extend DurableObject |
| BT-04 | PortfolioRisk.isDailyLossBreached() uses injectable clock instead of new Date() | Confirmed line 107 of portfolio.ts uses new Date(); two approaches documented (global override vs constructor param) |
| BT-05 | Each backtest run uses an isolated database (no cross-contamination between runs) | createTestDb() creates new :memory: SQLite per call — isolation is structural |
| BT-06 | Equity curve logged as timestamped balance snapshots during replay | EquitySnapshot interface; balance from simClient.getBalance() after each tick |
| BT-07 | LLM-dependent strategies use a mock LLM client in backtest | mockAI from test/helpers/mocks.ts; injected via env.AI in backtest env stub; minEdge: 0.05 ensures trade fires |
</phase_requirements>
