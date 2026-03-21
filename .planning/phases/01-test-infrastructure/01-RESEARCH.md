# Phase 1: Test Infrastructure - Research

**Researched:** 2026-03-21
**Domain:** Bun test runner, bun:sqlite, Drizzle ORM in-memory setup, strategy unit testing, mock injection
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | Vitest configured with in-memory SQLite for strategy unit tests | Bun test runner already used in `test/core/`; `bun:test` + `drizzle-orm/bun-sqlite` covers this; no Vitest install needed |
| TEST-02 | Drizzle schema applied to in-memory SQLite matching production D1 schema | `migrate(db, { migrationsFolder: './drizzle' })` from `drizzle-orm/bun-sqlite/migrator` applies existing `drizzle/0000_tiny_leader.sql` to `:memory:` DB |
| TEST-03 | Each of the 8 strategies has at least one unit test exercising a full tick cycle | All 8 tick functions accept `(bot: BaseBotDO, env: Env)` — mock both objects; 6 strategies exit early when `createExchangeClient` throws, providing a safe minimal test path; LLM strategies additionally guard on `env.AI` |
</phase_requirements>

---

## Summary

The project already has a working test foundation: three tests in `test/core/` use `bun:test` directly (no Vitest, despite the requirement ID name "Vitest"). The existing `"test": "bun test"` script in `package.json` is the correct runner — no new test framework installation is required. The CLAUDE.md says "Vitest + in-memory SQLite for unit tests" but the existing test files and the bun runtime together mean `bun:test` is the actual test runner. Research confirms this is intentional; `bun:test` is API-compatible with Jest/Vitest for `describe/test/expect`.

For in-memory SQLite, the correct path is `drizzle-orm/bun-sqlite` (import: `import { drizzle } from "drizzle-orm/bun-sqlite"`) with `new Database(":memory:")` from `bun:sqlite`. The existing migration file at `drizzle/0000_tiny_leader.sql` is complete and covers all 10 tables. The `migrate()` function from `drizzle-orm/bun-sqlite/migrator` applies those migrations to an in-memory DB, giving test code a fully-typed Drizzle instance with the real schema.

The central challenge for TEST-03 is that all 8 strategies call `createExchangeClient(env, platform)` which throws if credentials are absent. This is an early-return guard, not a crash — strategies catch the error and return. This makes the **minimal tick test pattern** straightforward: pass a minimal mock env without credentials, and the strategy exits cleanly after logging the init failure. For strategies that require more complete testing, a `MockExchangeClient` implementing the full `ExchangeClient` interface is needed. The two LLM strategies (`llm-assessor`, `deep-research`) have a separate guard: they check `env.AI` and return early if absent, making them the simplest to stub.

**Primary recommendation:** Use `drizzle-orm/bun-sqlite` + `bun:test` + the existing migration file. Build a shared `createTestDb()` helper and a `MockExchangeClient` class. All 8 strategy tick tests can use the early-return-on-missing-credentials path for a smoke test, with deeper fixture-driven tests for at least one representative strategy per group.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:test` | built-in (bun 1.3.10) | Test runner, describe/test/expect/mock | Already in use in `test/core/`; zero install |
| `bun:sqlite` | built-in (bun 1.3.10) | SQLite engine for in-memory DB | Fastest path; no extra deps; D1 is SQLite-compatible |
| `drizzle-orm/bun-sqlite` | 0.38.4 (installed) | Drizzle adapter for bun:sqlite | Shares schema types with production D1 adapter |
| `drizzle-orm/bun-sqlite/migrator` | 0.38.4 (installed) | Applies SQL migration files to bun:sqlite | Reuses existing `drizzle/` folder, no schema duplication |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:test` mock utilities | built-in | `mock()`, `spyOn()`, `beforeEach()` | Stubbing `env.AI`, exchange fetch calls |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `drizzle-orm/bun-sqlite` | `drizzle-orm/libsql` with `@libsql/client` | Extra dep; libsql is for Turso/remote; bun-sqlite is the right local adapter |
| Existing migration file | `drizzle-kit push` at test time | Push requires CLI subprocess; migration file is already committed and works programmatically |
| `bun:test` | Vitest | CLAUDE.md says "Vitest" but existing test files use `bun:test`; stay consistent with existing files |

**Installation:** No new packages required. `drizzle-orm` 0.38.4 is already installed and includes the `bun-sqlite` adapter.

---

## Architecture Patterns

### Recommended Test Structure
```
test/
├── core/
│   ├── analytics.test.ts   (exists)
│   ├── kelly.test.ts       (exists)
│   └── matcher.test.ts     (exists)
├── helpers/
│   ├── db.ts               (NEW: createTestDb() helper)
│   └── mocks.ts            (NEW: MockExchangeClient, MockBotDO, makeTestEnv())
└── strategies/
    ├── copy-trader.test.ts
    ├── cross-arb.test.ts
    ├── deep-research.test.ts
    ├── ladder-straddle.test.ts
    ├── llm-assessor.test.ts
    ├── logical-arb.test.ts
    ├── market-maker.test.ts
    └── weather-arb.test.ts
```

### Pattern 1: createTestDb() Helper
**What:** Returns a fresh Drizzle DB instance backed by a `:memory:` bun:sqlite database with the full schema applied.
**When to use:** Every test file that needs DB access; call in `beforeEach` for isolation.

```typescript
// test/helpers/db.ts
// Source: https://orm.drizzle.team/docs/get-started/bun-sqlite-existing
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../src/worker/core/db/schema";

export type TestDb = ReturnType<typeof createTestDb>;

export function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // Apply the production migration — all 10 tables, exact column names
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}
```

**Critical note:** `migrate()` from `drizzle-orm/bun-sqlite/migrator` is synchronous when used with bun:sqlite. No `await` needed. Confirmed by bun:sqlite being a synchronous driver.

### Pattern 2: MockExchangeClient
**What:** Implements the full `ExchangeClient` interface with configurable return values.
**When to use:** Any strategy test that needs to progress past the `createExchangeClient()` early-return guard.

```typescript
// test/helpers/mocks.ts
import type { ExchangeClient, MarketInfo, OrderBook, OrderResult, PositionInfo } from "../../src/worker/core/exchanges/types";

export class MockExchangeClient implements ExchangeClient {
  platform: "polymarket" | "kalshi" = "polymarket";

  markets: MarketInfo[] = [];
  priceMap: Record<string, { yes: number; no: number }> = {};
  balance = 1000;

  async getMarkets() { return { markets: this.markets }; }
  async getMarket(id: string): Promise<MarketInfo> {
    return this.markets.find(m => m.platformId === id) ?? {
      platformId: id, platform: "polymarket", title: id, status: "active",
    };
  }
  async getPrice(id: string) {
    return this.priceMap[id] ?? { yes: 0.5, no: 0.5 };
  }
  async getOrderBook(): Promise<OrderBook> {
    return { bids: [{ price: 0.49, size: 100 }], asks: [{ price: 0.51, size: 100 }] };
  }
  async placeOrder(): Promise<OrderResult> {
    return { orderId: "mock-order-1", status: "filled", filledPrice: 0.5, filledSize: 10 };
  }
  async cancelOrder() {}
  async getOrder(): Promise<OrderResult> {
    return { orderId: "mock-order-1", status: "filled" };
  }
  async getOpenOrders(): Promise<OrderResult[]> { return []; }
  async getPositions(): Promise<PositionInfo[]> { return []; }
  async getBalance() { return this.balance; }
}
```

### Pattern 3: MockBotDO (duck-typed BaseBotDO)
**What:** A plain object with the properties and methods strategies access via `(bot as any)`.
**When to use:** Required by every strategy tick test — strategies read `(bot as any).config` and call `(bot as any).recordTrade()`.

```typescript
// test/helpers/mocks.ts (continued)
import type { BotConfig, TradeRecord } from "../../src/worker/bots/base";

export function makeMockBot(config: Partial<BotConfig> & { botType: string }) {
  const trades: TradeRecord[] = [];
  return {
    config: {
      botType: config.botType,
      name: config.name ?? "test-bot",
      tickIntervalMs: 5000,
      dbBotId: 1,
      ...config,
    } as BotConfig,
    recordTrade: async (trade: TradeRecord) => {
      trades.push(trade);
      return trades.length; // mock trade ID
    },
    _trades: trades, // test inspection
  };
}
```

### Pattern 4: makeTestEnv() — Minimal Env Stub
**What:** Constructs a minimal `Env` object. Two modes: no-credentials (triggers early return) or with-mock-db.
**When to use:** All strategy tests.

```typescript
// test/helpers/mocks.ts (continued)
import { createDb } from "../../src/worker/core/db/client";

export function makeTestEnv(db: ReturnType<typeof createTestDb>): Env {
  // Cast to satisfy TypeScript — strategies access env.DB, env.AI
  return {
    DB: db as unknown as D1Database,
    BOT_DO: {} as DurableObjectNamespace,
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "test",
    // No POLYMARKET_* or KALSHI_* keys — createExchangeClient will throw
    // No AI binding — llm-assessor and deep-research will return early
  } as unknown as Env;
}
```

**Key insight:** Strategies call `createDb(env.DB)` passing the D1Database binding. At test time, `env.DB` is a bun:sqlite-backed Drizzle instance cast as `D1Database`. This works because `createDb` calls `drizzle(d1, { schema })` — but at test time the `d1` argument is already a Drizzle DB, causing a double-wrap. The fix is to bypass `createDb` by patching the factory or by using module-level dependency injection. **Preferred approach:** pass the test DB directly to `createDb`'s underlying call by replacing `env.DB` with an object that satisfies the D1Database interface calls Drizzle makes (which is none — Drizzle wraps D1 at construction time).

Actually, the **cleanest approach** is to not call `createDb(env.DB)` at test time at all. Since strategies call `createDb(env.DB)` at the top of each tick function, a test can mock `createDb` using `bun:test`'s `mock.module()` to return the test DB instance. This requires zero changes to production strategy code.

```typescript
// In each strategy test file:
import { mock } from "bun:test";
import { createTestDb } from "../helpers/db";

const testDb = createTestDb();

mock.module("../../src/worker/core/db/client", () => ({
  createDb: () => testDb,
}));
```

### Pattern 5: Early-Return Smoke Test (minimal tick verification)
**What:** Verifies a tick function completes without throwing when exchange credentials are absent.
**When to use:** Baseline test for all 8 strategies; proves the module imports and runs without crashing.

```typescript
// test/strategies/copy-trader.test.ts
import { describe, test, expect } from "bun:test";
import { copyTraderTick } from "../../src/worker/bots/copy-trader/strategy";
import { makeMockBot, makeTestEnv } from "../helpers/mocks";
import { createTestDb } from "../helpers/db";

describe("copyTraderTick", () => {
  test("exits cleanly when no traders configured", async () => {
    const db = createTestDb();
    const bot = makeMockBot({ botType: "copy-trader" });
    const env = makeTestEnv(db);
    // No traderIds in config — strategy returns early without exchange call
    await expect(copyTraderTick(bot as any, env)).resolves.toBeUndefined();
  });
});
```

### Anti-Patterns to Avoid
- **Wrapping D1 twice:** Don't pass a bun:sqlite `Database` raw object as `env.DB` and then let `createDb(env.DB)` try to drizzle-wrap it again. Use `mock.module` to return the test db directly from `createDb`.
- **Sharing in-memory DB across tests:** Always call `createTestDb()` fresh per test or per describe block. In-memory DBs are stateful — seed data from one test leaks into the next.
- **Importing `cloudflare:workers`:** `BaseBotDO` extends `DurableObject` which imports from `cloudflare:workers`. Strategy tests must NOT import `BaseBotDO` directly. Use the `makeMockBot()` duck-typed object instead.
- **Using `tsconfig.json` types in tests:** The root `tsconfig.json` includes `"types": ["@cloudflare/workers-types"]` which defines `D1Database` etc. globally. Test files benefit from this. Do not create a separate test tsconfig unless tests fail to find global types.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite schema in tests | Custom SQL `CREATE TABLE` statements in test helpers | `migrate(db, { migrationsFolder: './drizzle' })` | Migration file already exists and is the single source of truth; hand-rolled SQL drifts |
| Test runner | Vitest install + vitest.config.ts | `bun test` (already configured) | Three existing test files already work with `bun:test`; adding Vitest creates dual-runner confusion |
| D1-compatible mock | Custom D1Database implementation | `mock.module` intercept of `createDb` | D1Database interface is vast; intercepting at the Drizzle factory level is one line |
| LLM stub | Full Workers AI mock | `env.AI = undefined` (absence guard) | Both LLM strategies check `if (!env.AI)` and return early; passing no AI binding is sufficient for smoke tests |

**Key insight:** The existing migration file is the schema oracle. Any alternative schema definition (hand-rolled SQL, schema push) risks column name drift from production.

---

## LLM Client Injection Point Audit

This resolves the blocker documented in STATE.md: "LLM client injection point in llm-assessor and deep-research not yet confirmed from source."

**Finding:** There is no injected LLM client interface. Both strategies call `env.AI!.run(model, { messages })` directly — the Workers AI binding is the only injection point.

| Strategy | LLM Injection Point | Guard | Mock Approach |
|----------|--------------------|---------|----|
| `llm-assessor` | `env.AI!.run(config.aiModel, { messages })` | `if (!env.AI) { log.error(...); return; }` | Set `env.AI = undefined` — tick returns before any LLM call |
| `deep-research` | `env.AI!.run(config.aiModel, { messages })` (3 calls per market) | `if (!env.AI) { log.error(...); return; }` | Set `env.AI = undefined` — tick returns before any LLM call |

**MockLLMClient stub** (for Phase 4 backtest engine, but can be defined here per TEST-03 success criterion):
```typescript
// test/helpers/mocks.ts
export const mockAI: Ai = {
  run: async (_model: string, inputs: any) => {
    // Return a valid probability JSON that both strategies can parse
    return { response: JSON.stringify({ probability: 0.6, reasoning: "mock" }) };
  },
} as unknown as Ai;
```

To use in a test that exercises LLM strategy logic beyond the early-return:
```typescript
const env = makeTestEnv(db);
(env as any).AI = mockAI;
```

**Conclusion:** No new LLM client abstraction is needed in Phase 1. The `env.AI` guard provides a clean boundary. The `MockLLMClient` (named `mockAI` above) is a simple object stub, not a class.

---

## Common Pitfalls

### Pitfall 1: `cloudflare:workers` Import in Strategy Tests
**What goes wrong:** Importing any file that transitively imports from `cloudflare:workers` (e.g., `base.ts` which extends `DurableObject`) causes bun to throw "Cannot find module 'cloudflare:workers'" outside a Wrangler context.
**Why it happens:** `BaseBotDO extends DurableObject<Env>` is in `base.ts`. Any test that imports `base.ts` triggers this.
**How to avoid:** Never import `BaseBotDO` in test files. Use `makeMockBot()` duck-typed object. Mock the bot's `config` and `recordTrade` as plain properties/functions.
**Warning signs:** `Error: Cannot find module 'cloudflare:workers'` during `bun test`.

### Pitfall 2: Double-Wrapping the Drizzle DB
**What goes wrong:** Passing a bun:sqlite `Database` instance as `env.DB` then letting production code call `drizzle(env.DB, { schema })` again results in a malformed DB object.
**Why it happens:** `createDb(d1)` calls `drizzle(d1, { schema })`. In production `d1` is a D1Database. In tests if you pass a raw `Database` it's being drizzle-wrapped twice.
**How to avoid:** Use `mock.module("../../src/worker/core/db/client", () => ({ createDb: () => testDb }))` so `createDb()` returns the already-wrapped test DB.
**Warning signs:** `TypeError: db.select is not a function` or Drizzle query errors in tests.

### Pitfall 3: `migrate()` Calling Pattern for bun:sqlite
**What goes wrong:** Calling `await migrate(db, ...)` when bun:sqlite's migrate is synchronous causes confusing behavior or no-op.
**Why it happens:** The bun:sqlite adapter is synchronous; the D1 adapter is async. Drizzle's `migrate` for bun-sqlite does not return a Promise.
**How to avoid:** Call `migrate(db, { migrationsFolder: "./drizzle" })` without `await`.
**Warning signs:** Schema tables missing despite `migrate()` call appearing to succeed.

### Pitfall 4: Test DB Isolation
**What goes wrong:** Two tests sharing the same in-memory DB instance leave behind rows, causing `UNIQUE constraint failed` or wrong row counts.
**Why it happens:** In-memory SQLite persists for the lifetime of the `Database` object. Multiple tests in the same describe block that call `createTestDb()` once will share state.
**How to avoid:** Call `createTestDb()` inside `beforeEach` or at the top of each `test()` block, not at module level.
**Warning signs:** Tests pass in isolation, fail when run together.

### Pitfall 5: Strategy Config Casting Pattern
**What goes wrong:** Strategies cast `(bot as any).config as SpecificConfig`. If the mock bot's config is missing expected fields, strategies proceed past guards and crash on `undefined.property`.
**Why it happens:** TypeScript types are erased at runtime; the cast provides no validation.
**How to avoid:** When writing tick tests that go beyond the early-return path, provide a complete config matching the strategy's `*Config` type. Read the `config.ts` for each strategy to see required fields.
**Warning signs:** `TypeError: Cannot read properties of undefined` inside the strategy tick function.

---

## Code Examples

### Complete Test Setup for a Strategy (beyond smoke test)

```typescript
// test/strategies/logical-arb.test.ts
// Source: based on test/core/kelly.test.ts patterns + research findings
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createTestDb } from "../helpers/db";
import { makeMockBot, makeTestEnv, MockExchangeClient } from "../helpers/mocks";

// Module mock must be declared BEFORE importing the strategy
const mockClient = new MockExchangeClient();
mock.module("../../src/worker/core/exchanges/factory", () => ({
  createExchangeClient: () => mockClient,
}));

// Also mock createDb to return test DB
let testDb: ReturnType<typeof createTestDb>;
mock.module("../../src/worker/core/db/client", () => ({
  createDb: () => testDb,
}));

// Import strategy AFTER mocks are set
const { logicalArbTick } = await import("../../src/worker/bots/logical-arb/strategy");

describe("logicalArbTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.markets = [{
      platformId: "mkt-1",
      platform: "polymarket",
      title: "Test Market",
      status: "active",
    }];
    mockClient.priceMap = { "mkt-1": { yes: 0.6, no: 0.5 } }; // sum > 1, arb opportunity
  });

  test("detects logical arb violation and places orders", async () => {
    const bot = makeMockBot({
      botType: "logical-arb",
      platform: "polymarket",
      violationThreshold: 0.05,
      maxPositionSize: 10,
    });
    const env = makeTestEnv(testDb);

    await logicalArbTick(bot as any, env);

    // If spread = 0.1 > threshold 0.05, strategy should attempt trades
    // MockExchangeClient.placeOrder returns filled status
    expect(bot._trades.length).toBeGreaterThan(0);
  });
});
```

### Schema Verification Test

```typescript
// test/core/schema.test.ts
import { describe, test, expect } from "bun:test";
import { createTestDb } from "../helpers/db";

describe("in-memory schema", () => {
  test("all 10 tables exist after migration", () => {
    const db = createTestDb();
    // Query sqlite_master to verify table names
    const tables = db.$client.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain("markets");
    expect(tableNames).toContain("prices");
    expect(tableNames).toContain("bot_instances");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("trades");
    expect(tableNames).toContain("positions");
    expect(tableNames).toContain("bot_metrics");
    expect(tableNames).toContain("tracked_traders");
    expect(tableNames).toContain("market_links");
    expect(tableNames).toContain("audit_log");
    expect(tableNames.length).toBe(10);
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate test DB setup (raw SQL) | `drizzle migrate` from migration file | Drizzle 0.30+ | Schema stays in sync automatically |
| Jest for Bun projects | `bun:test` | Bun 1.0+ | No separate install; Jest-compatible API |
| Vitest for Workers testing | `bun:test` + module mocks | Bun 1.x | Simpler for projects not using Vite's test transform |

**Deprecated/outdated:**
- `@databases/sqlite` or `better-sqlite3`: Not needed; `bun:sqlite` is built-in to bun runtime.
- Vitest config for this project: CLAUDE.md mentions Vitest but the actual test files use `bun:test`. Don't add a Vitest config — it would create a second runner.

---

## Open Questions

1. **`mock.module` vs static imports in bun:test**
   - What we know: bun:test supports `mock.module()` for ESM module mocking, but there are known limitations with static top-level imports in bun < 1.1.
   - What's unclear: Whether bun 1.3.10 fully supports `mock.module` before dynamic `import()` in all cases. The pattern `mock.module(...); const { fn } = await import(...)` is the safe pattern.
   - Recommendation: Use dynamic import after `mock.module()` calls for strategy files. Document this in the test helpers.

2. **`$client` accessor on Drizzle bun-sqlite instance**
   - What we know: Drizzle wraps the bun:sqlite `Database` and exposes it. The accessor name is conventionally `.$client` based on drizzle-bun docs.
   - What's unclear: Whether `db.$client` is the correct property name for `drizzle-orm/bun-sqlite` 0.38.x or if it changed.
   - Recommendation: In the schema verification test, if `db.$client` is unavailable, fall back to `(db as any)._client` or use `db.run("SELECT ...")` via Drizzle's SQL raw query.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in, bun 1.3.10) |
| Config file | none — `bun test` discovers `**/*.test.ts` automatically |
| Quick run command | `bun test test/strategies/` |
| Full suite command | `bun test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | `bun test` runs with in-memory SQLite; at least one passing test | smoke | `bun test test/core/schema.test.ts` | Wave 0 |
| TEST-02 | All 10 schema tables exist in test DB with correct names | unit | `bun test test/core/schema.test.ts` | Wave 0 |
| TEST-03 (x8) | Each of 8 strategies completes a tick cycle without throwing | unit | `bun test test/strategies/` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test test/strategies/` (strategy under work)
- **Per wave merge:** `bun test`
- **Phase gate:** `bun test` full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/helpers/db.ts` — `createTestDb()` helper using drizzle-orm/bun-sqlite/migrator
- [ ] `test/helpers/mocks.ts` — `MockExchangeClient`, `makeMockBot()`, `makeTestEnv()`, `mockAI`
- [ ] `test/core/schema.test.ts` — covers TEST-01 and TEST-02
- [ ] `test/strategies/copy-trader.test.ts` — covers TEST-03 for copy-trader
- [ ] `test/strategies/cross-arb.test.ts` — covers TEST-03 for cross-arb
- [ ] `test/strategies/deep-research.test.ts` — covers TEST-03 for deep-research (LLM early-return path)
- [ ] `test/strategies/ladder-straddle.test.ts` — covers TEST-03 for ladder-straddle
- [ ] `test/strategies/llm-assessor.test.ts` — covers TEST-03 for llm-assessor (LLM early-return path)
- [ ] `test/strategies/logical-arb.test.ts` — covers TEST-03 for logical-arb
- [ ] `test/strategies/market-maker.test.ts` — covers TEST-03 for market-maker
- [ ] `test/strategies/weather-arb.test.ts` — covers TEST-03 for weather-arb

---

## Sources

### Primary (HIGH confidence)
- Official Drizzle docs — `drizzle-orm/bun-sqlite` import path, `migrate()` from `drizzle-orm/bun-sqlite/migrator`, in-memory Database constructor: https://orm.drizzle.team/docs/get-started/bun-sqlite-existing
- Source code audit — all 8 strategy files read; LLM injection points confirmed by direct code inspection of `src/worker/bots/llm-assessor/strategy.ts` and `src/worker/bots/deep-research/strategy.ts`
- Source code audit — `BaseBotDO` interface in `src/worker/bots/base.ts`; `ExchangeClient` interface in `src/worker/core/exchanges/types.ts`
- Existing test files in `test/core/` — confirmed `bun:test` import pattern (`import { describe, test, expect } from "bun:test"`)
- Existing migration file `drizzle/0000_tiny_leader.sql` — all 10 tables confirmed, exact column names documented

### Secondary (MEDIUM confidence)
- Bun documentation — `bun:test` runner flags, `mock.module()` API: https://bun.com/docs/guides/ecosystem/drizzle
- Bun version 1.3.10 (verified via `bun --version`)

### Tertiary (LOW confidence)
- `$client` accessor name on drizzle bun-sqlite instance — referenced in search results and community discussions but not verified against drizzle-orm 0.38.x changelog directly

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — drizzle-orm is installed, bun:test is in use, migration file exists
- Architecture: HIGH — all strategy source files read; mock patterns derived from actual interfaces
- LLM injection audit: HIGH — direct source code inspection confirms `env.AI` is the only injection point
- Pitfalls: HIGH — derived from TypeScript/CloudflareWorkers import constraints (cloudflare:workers pitfall) and Drizzle adapter mechanics
- `mock.module` dynamic import pattern: MEDIUM — bun:test docs confirm the feature; exact behavior in 1.3.10 not verified against a running test

**Research date:** 2026-03-21
**Valid until:** 2026-06-21 (drizzle-orm 0.38 stable; bun 1.x stable API)
