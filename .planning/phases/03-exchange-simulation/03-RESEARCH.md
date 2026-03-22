# Phase 3: Exchange Simulation - Research

**Researched:** 2026-03-22
**Domain:** Simulated exchange client implementing ExchangeClient interface with fee models, partial fill simulation, virtual balance management, and factory extension
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXCH-01 | SimExchangeClient implements the full ExchangeClient interface | Direct interface audit of `src/worker/core/exchanges/types.ts` — 11 methods across 5 groups |
| EXCH-02 | SimExchangeClient serves prices from seeded data at current tick timestamp only (look-ahead bias guard) | PriceFeed.latestAt(simulatedNow) from Phase 2 — direct call, no lookahead possible |
| EXCH-03 | SimExchangeClient applies Polymarket fee schedule (0% maker / 2% taker) on fills | Researched Polymarket docs — but docs show markets are mostly fee-free now; REQUIREMENTS.md specifies 2% taker as the target, treat as configurable simulation parameter |
| EXCH-04 | SimExchangeClient applies Kalshi fee schedule (1.75¢/contract max) on fills | Verified: taker = round_up(0.07 × C × P × (1-P)), max 1.75¢ at P=0.50 |
| EXCH-05 | SimExchangeClient models partial fills and leg-2 failure at configurable rates for cross-arb | Random draw against configured `partialFillRate` and `leg2FailRate` using seeded PRNG |
| EXCH-06 | SimExchangeClient supports configurable virtual starting balance per bot | `virtualBalance` field on SimConfig; `getBalance()` returns running balance; placeOrder deducts on fill |
| EXCH-07 | createExchangeClient factory extended with simulation mode (one-line production change) | Add `simulationFeed?: PriceFeed` to factory signature; branch on its presence |
</phase_requirements>

---

## Summary

Phase 3 builds `SimExchangeClient`, a complete implementation of the `ExchangeClient` interface that replaces live exchange calls with deterministic, fee-aware simulation. It consumes the `PriceFeed` class from Phase 2 for all price lookups. The core design is a stateful class holding virtual balance, an in-memory order book, and positions — all updated synchronously on `placeOrder` calls.

The factory extension (EXCH-07) is a one-line change: `createExchangeClient` gains an optional third parameter `simulationFeed?: PriceFeed`. When present, it returns a `SimExchangeClient` instead of a real client. This design means callers never change; the swap happens at the call site where the factory is invoked.

Fee simulation must match the referenced schedules exactly to satisfy the success criteria. For Polymarket, the REQUIREMENTS.md specifies 0% maker / 2% taker — this predates recent Polymarket fee changes but is the explicit requirement target. For Kalshi, the fee is computed as `round_up(0.07 * C * P * (1-P))` which maxes at 1.75¢ per contract at P=0.50. Partial fill and leg-2 failure rates are configured per-instance so tests can set them to deterministic values.

**Primary recommendation:** Implement `SimExchangeClient` as a class in `src/worker/core/simulation/sim-client.ts`. Accept a `SimClientConfig` interface. Use the Phase 2 `PriceFeed.latestAt()` for all price resolution. Use the Phase 2 `createPrng()` for all probabilistic behavior (partial fills, leg-2 failures). Extend the existing factory with an optional `simulationFeed` parameter.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:test` (built-in) | built-in | Test runner | Already established in Phases 1 and 2 |
| Phase 2 `PriceFeed` | local | No-lookahead price access | Already implemented; exact API is `latestAt(simulatedNow)` |
| Phase 2 `createPrng` | local | Seeded PRNG for partial fill probability | Already implemented; no new deps |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | No additional packages needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Seeded PRNG for partial fills | `Math.random()` | Math.random makes tests non-deterministic; seeded PRNG enables reproducible failure scenarios |
| In-memory state in class | External DB for sim state | DB access would require async setup per test; in-memory state is faster and self-contained |
| Optional third factory param | Separate `createSimExchangeClient` function | Third param keeps the one-line change promise (EXCH-07 success criterion #1); separate function would require callers to change import |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure
```
src/worker/core/simulation/
├── prng.ts            # (Phase 2 — existing)
├── generator.ts       # (Phase 2 — existing)
├── feed.ts            # (Phase 2 — existing)
├── types.ts           # (Phase 2 — existing; extend with SimClientConfig)
└── sim-client.ts      # NEW — SimExchangeClient class
test/core/
├── sim-client.test.ts # NEW — EXCH-01 through EXCH-07 tests
```

No new directories. The simulation client is co-located with the existing simulation infrastructure under `src/worker/core/simulation/`.

### Pattern 1: SimClientConfig Interface
**What:** Configuration injected at construction time. All probabilistic behavior is seed-controlled; all fee behavior is configurable.
**When to use:** Both direct instantiation in tests and via factory extension.

```typescript
// src/worker/core/simulation/sim-client.ts
import type { PriceFeed } from "./feed";
import { createPrng } from "./prng";

export interface SimClientConfig {
  platform: "polymarket" | "kalshi";
  /** PriceFeed from Phase 2 — provides no-lookahead price access */
  feed: PriceFeed;
  /** ISO-8601 timestamp of current simulated time — updated by BacktestClock in Phase 4 */
  simulatedNow: () => string;
  /** Virtual balance in USD — enforced on fill */
  virtualBalance: number;
  /** Taker fee rate as decimal (e.g. 0.02 for 2%) — Polymarket default */
  takerFeeRate?: number;
  /** Rate at which orders partially fill (0 = never, 1 = always) */
  partialFillRate?: number;
  /** Rate at which the second leg of an order fails (0 = never) */
  leg2FailRate?: number;
  /** Seed for PRNG controlling fill behavior — enables reproducible tests */
  seed?: number;
}
```

**Key design note:** `simulatedNow` is a function (not a string value) so Phase 4's `BacktestClock` can inject a getter that advances over time without reconstructing the client.

### Pattern 2: SimExchangeClient Class
**What:** Stateful class implementing ExchangeClient. Holds in-memory order store, position store, and running balance.
**When to use:** Anywhere a real exchange client would be used in backtest or paper trading mode.

```typescript
export class SimExchangeClient implements ExchangeClient {
  readonly platform: "polymarket" | "kalshi";
  private feed: PriceFeed;
  private getNow: () => string;
  private balance: number;
  private takerFeeRate: number;
  private partialFillRate: number;
  private leg2FailRate: number;
  private rng: () => number;
  private orders: Map<string, OrderResult>;
  private positions: Map<string, PositionInfo>;
  private orderCounter: number;

  constructor(config: SimClientConfig) {
    this.platform = config.platform;
    this.feed = config.feed;
    this.getNow = config.simulatedNow;
    this.balance = config.virtualBalance;
    this.takerFeeRate = config.takerFeeRate ?? 0.02;
    this.partialFillRate = config.partialFillRate ?? 0;
    this.leg2FailRate = config.leg2FailRate ?? 0;
    this.rng = createPrng(config.seed ?? 1);
    this.orders = new Map();
    this.positions = new Map();
    this.orderCounter = 0;
  }
  // ... interface methods
}
```

### Pattern 3: Fee Calculation
**What:** Platform-specific fee computation applied at fill time. Fees reduce proceeds on the filled amount.
**When to use:** Inside `placeOrder` after determining fill size.

```typescript
// Polymarket: taker fee = filledSize * filledPrice * takerFeeRate
// Result: buyer receives 2% fewer contracts worth of proceeds
private computePolymarketFee(size: number, price: number): number {
  return size * price * this.takerFeeRate;
}

// Kalshi: taker fee = round_up(0.07 * C * P * (1-P)), max 1.75¢/contract
// P is in dollars (0–1), C is contract count
private computeKalshiFee(size: number, price: number): number {
  const feePerContract = Math.ceil(0.07 * price * (1 - price) * 10000) / 10000;
  // max is at P=0.5: 0.07 * 0.5 * 0.5 = 0.0175 = 1.75¢
  return feePerContract * size;
}
```

### Pattern 4: Partial Fill Simulation
**What:** On each `placeOrder` call, roll against `partialFillRate`. If triggered, fill a random fraction (50–99%) of the requested size. The second-leg failure is a separate independent roll against `leg2FailRate`.
**When to use:** All `placeOrder` calls. The `leg2FailRate` check applies to the second order in a sequence — the cross-arb strategy places two orders; the second placeOrder call is the "leg 2."

```typescript
private shouldPartialFill(): boolean {
  return this.rng() < this.partialFillRate;
}

private shouldLeg2Fail(): boolean {
  return this.rng() < this.leg2FailRate;
}

private partialFillSize(requestedSize: number): number {
  // Fill between 50% and 99% of requested size
  const fraction = 0.5 + this.rng() * 0.49;
  return requestedSize * fraction;
}
```

**Critical:** The cross-arb strategy (see `src/worker/bots/cross-arb/strategy.ts`) calls `placeOrder` twice per linked pair — once for each leg. The sim client does not know which call is "leg 2." The cleanest approach is to apply `leg2FailRate` on every `placeOrder` call independently; the statistical outcome over many calls approximates the configured rate.

### Pattern 5: Factory Extension (EXCH-07)
**What:** Add an optional `simulationFeed` parameter to `createExchangeClient`. When present, return a `SimExchangeClient`.
**When to use:** The one-line change in production: pass `env._simulationFeed` if defined.

```typescript
// src/worker/core/exchanges/factory.ts — modified signature only
export function createExchangeClient(
  env: Env,
  platform: "polymarket" | "kalshi",
  simulationFeed?: { feed: PriceFeed; config?: Partial<SimClientConfig> }
): ExchangeClient {
  if (simulationFeed) {
    return new SimExchangeClient({
      platform,
      feed: simulationFeed.feed,
      simulatedNow: () => new Date().toISOString(),
      virtualBalance: simulationFeed.config?.virtualBalance ?? 1000,
      ...simulationFeed.config,
    });
  }
  // ... existing real client logic unchanged
}
```

**Note:** `env.d.ts` does not need a `_simulationFeed` binding because the feed is passed programmatically, not via the Cloudflare binding system. The caller (backtest engine in Phase 4) creates the feed and passes it directly.

### Pattern 6: getPrice and getOrderBook from PriceFeed
**What:** `getPrice` and `getOrderBook` both delegate to `PriceFeed.latestAt(this.getNow())`. The order book is synthesized from the latest price row using a configurable spread.
**When to use:** Every price lookup in the sim client.

```typescript
async getPrice(id: string): Promise<{ yes: number; no: number }> {
  const row = this.feed.latestAt(this.getNow());
  if (!row) return { yes: 0.5, no: 0.5 };
  return { yes: row.yesPrice, no: row.noPrice };
}

async getOrderBook(_id: string): Promise<OrderBook> {
  const row = this.feed.latestAt(this.getNow());
  const mid = row?.yesPrice ?? 0.5;
  const halfSpread = 0.01;
  return {
    bids: [{ price: Math.max(0.01, mid - halfSpread), size: 1000 }],
    asks: [{ price: Math.min(0.99, mid + halfSpread), size: 1000 }],
    timestamp: this.getNow(),
  };
}
```

### Anti-Patterns to Avoid
- **Checking `platform === "polymarket"` vs `"kalshi"` for fee dispatch:** Instead, set `feeCalculator` as a strategy at construction time based on platform. This avoids if/else inside hot paths.
- **Storing sim state in the database during tests:** The sim client is in-memory. Writing to the test DB (which tests can share) would cause cross-test contamination. The DB is only written by `BaseBotDO.recordTrade()`, not by the exchange client.
- **Using `Math.random()` for partial fill decisions:** Non-deterministic; breaks the reproducibility guarantee. Use `createPrng(seed)` always.
- **Making `simulatedNow` a string field (not a function):** A string field would be stale after construction. Phase 4's BacktestClock needs to advance the clock between ticks without reconstructing the client. A function getter enables this.
- **Deducting fees from `balance` separately:** Fee and fill cost should be deducted atomically in `placeOrder`. Split deduction creates a window where balance checks could pass incorrectly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| No-lookahead price access | Custom array slice with index tracking | `PriceFeed.latestAt(simulatedNow)` | Already implemented, tested, and proven in Phase 2 |
| Seeded probabilistic behavior | Custom LCG or random math | `createPrng(seed)` from `simulation/prng.ts` | Already implemented, CF Workers compatible, statistically sound |
| Order ID generation | UUID or crypto-based IDs | Sequential counter with prefix: `sim-poly-001` | UUIDs require crypto APIs; a counter is deterministic and sufficient for in-memory testing |
| Kalshi fee math | Custom formula | Verified formula: `ceil(0.07 * C * P * (1-P) * 10000) / 10000` | The parabolic formula is exact; a custom approximation will fail the 1.75¢ cap test |

**Key insight:** All non-trivial infrastructure (PRNG, price feed, no-lookahead guard) was built in Phase 2. Phase 3 assembles these components into an interface implementation; it should not re-derive any of Phase 2's logic.

---

## Fee Schedule Reference

### Polymarket (per REQUIREMENTS.md specification)
The REQUIREMENTS.md specifies 0% maker / 2% taker as the fee model to simulate (EXCH-03). This is the legacy fee schedule that was in place when strategies were designed. The actual current Polymarket fee structure has changed (most markets are fee-free; select markets have variable rates). For simulation purposes, use the spec-defined values:
- **Taker fee:** 2% of `filledSize * filledPrice`
- **Maker fee:** 0% (maker = `postOnly: true` on the order)

**Fee application:** The strategy receives `filledPrice` and `filledSize` in `OrderResult`. For a taker buy of 100 contracts at 0.50, fee = `100 * 0.50 * 0.02 = $1.00`. Net cost to buyer = `$50 + $1 = $51`. The simulated balance deducts `cost + fee`.

### Kalshi (verified via web search + official formula cross-reference)
Formula: `fee_per_contract = ceil(0.07 * P * (1 - P) * 10000) / 10000` where P is in USD (0 to 1).

| Price (P) | Fee per contract |
|-----------|------------------|
| 0.50 | 1.75¢ (maximum) |
| 0.30 | 1.47¢ |
| 0.10 | 0.63¢ |
| 0.01 | 0.07¢ |

**Fee cap:** The cap is structural — it emerges from the parabolic formula peaking at P=0.50. There is no separate cap constant to implement; the formula produces the cap naturally.

**Confidence note:** The 1.75¢ cap was flagged as a potential change in STATE.md's blockers. This research confirms the formula is current as of March 2026 (multiple sources including official fee schedule search results and academic papers citing the live structure). Confidence: MEDIUM-HIGH (formula verified via multiple sources; official PDF was rate-limited at research time).

---

## Common Pitfalls

### Pitfall 1: Balance Check Before vs. After Fee
**What goes wrong:** Checking `if (order.size * order.price > this.balance)` before computing fees lets an order pass the balance check but then fail to deduct fees — leaving balance negative.
**Why it happens:** Fee is computed after the fill decision.
**How to avoid:** Compute estimated fee first, then check `cost + fee > this.balance`. Reject with status `"failed"` if insufficient.
**Warning signs:** `getBalance()` returning negative values in tests.

### Pitfall 2: `simulatedNow` Getter Stale After Construction
**What goes wrong:** If `simulatedNow` is stored as a string at construction time, all price lookups use the construction timestamp. Phase 4 advances the clock but prices never update.
**Why it happens:** Constructor stored `config.simulatedNow` as `this.now = config.simulatedNow` where it was a string.
**How to avoid:** Store `simulatedNow` as `() => string` (a getter function). Construction passes `() => clock.now()` not `clock.now()`.
**Warning signs:** `getPrice()` always returning the same value regardless of `simulatedNow` advancement.

### Pitfall 3: Partial Fill Rate Test Requires Large Sample
**What goes wrong:** Testing "30% failure rate produces ~30% failures" with 10 samples is flaky — binomial variance at n=10, p=0.30 is high.
**Why it happens:** Small sample sizes have high variance.
**How to avoid:** Use n >= 100 in the partial fill rate test. With n=100, p=0.30, stddev ≈ 4.5%, so observed rate within ±10% of 30% is expected with high probability. The success criterion says "roughly 30%." Use `toBeGreaterThan(0.20)` and `toBeLessThan(0.40)`.
**Warning signs:** Test flakiness — passes sometimes, fails others. Reduce seed-sensitivity by using n=200.

### Pitfall 4: getMarkets / getMarket Must Return Valid MarketInfo
**What goes wrong:** Strategies call `getMarkets()` and read `m.platformId`, `m.platform`, `m.status`. If the sim client returns empty arrays or undefined fields, strategies silently skip all markets.
**Why it happens:** Sim client returns `[]` for convenience; developer forgot strategies need markets to find arb opportunities.
**How to avoid:** `getMarkets()` should return the market info derived from the PriceFeed's scenario. Since `GeneratedScenario` has a `market` field (from Phase 2), the sim client can expose it as a `MarketInfo`.
**Warning signs:** Strategy tick completes with no orders placed even when spread is wide.

### Pitfall 5: Kalshi Fee Formula Precision — Integer Cents
**What goes wrong:** Computing `0.07 * 0.5 * 0.5 = 0.0175` and using it as-is gives 1.75¢ exactly. But at P=0.30: `0.07 * 0.30 * 0.70 = 0.0147` — a round-up to nearest cent gives 1.47¢, not 1.47000000001¢ due to floating point.
**Why it happens:** The formula requires `ceil` in whole cents. JavaScript floating point may produce `0.014699999999` instead of `0.0147`.
**How to avoid:** Multiply by 10000, apply `Math.ceil()`, divide by 10000. This rounds to the nearest 0.0001 dollar (0.01 cent), which is precise enough for the simulation's purposes.
**Warning signs:** Fee value in test is off by a fraction of a cent, causing the cap test to fail.

### Pitfall 6: `isolatedModules` Requires `import type` for Type-Only Imports
**What goes wrong:** `import { SimClientConfig } from "./sim-client"` in a test file that only uses the type causes a TypeScript compile error under `isolatedModules: true`.
**Why it happens:** The project has `isolatedModules: true` in `tsconfig.json` (confirmed from CLAUDE.md).
**How to avoid:** Use `import type { SimClientConfig }` for all type-only imports. This is consistent with the existing codebase convention.

---

## Code Examples

### SimExchangeClient placeOrder (core logic)

```typescript
// src/worker/core/simulation/sim-client.ts
async placeOrder(order: OrderRequest): Promise<OrderResult> {
  const orderId = `sim-${this.platform}-${String(++this.orderCounter).padStart(4, "0")}`;

  // 1. Check for leg-2 failure (independent roll for every order)
  if (this.rng() < this.leg2FailRate) {
    const result: OrderResult = { orderId, status: "failed" };
    this.orders.set(orderId, result);
    return result;
  }

  // 2. Determine fill size (partial fill check)
  const isTaker = !order.postOnly;
  let fillSize = order.size;
  let status: OrderResult["status"] = "filled";

  if (isTaker && this.rng() < this.partialFillRate) {
    const fraction = 0.5 + this.rng() * 0.49;
    fillSize = order.size * fraction;
    status = "partial";
  }

  // 3. Compute fill price from current feed
  const priceRow = this.feed.latestAt(this.getNow());
  const midPrice = priceRow
    ? (order.outcome === "yes" ? priceRow.yesPrice : priceRow.noPrice)
    : order.price;
  const filledPrice = midPrice;

  // 4. Compute fee
  const fee = this.computeFee(fillSize, filledPrice, isTaker);

  // 5. Compute cost and check balance
  const cost = fillSize * filledPrice + fee;
  if (cost > this.balance) {
    const result: OrderResult = { orderId, status: "failed" };
    this.orders.set(orderId, result);
    return result;
  }

  // 6. Deduct from balance
  this.balance -= cost;

  // 7. Update positions
  this.upsertPosition(order.marketId, order.outcome, fillSize, filledPrice);

  const result: OrderResult = {
    orderId,
    status,
    filledPrice,
    filledSize: fillSize,
    remainingSize: order.size - fillSize,
  };
  this.orders.set(orderId, result);
  return result;
}
```

### Factory extension (minimal diff)

```typescript
// src/worker/core/exchanges/factory.ts — extended
import type { PriceFeed } from "../simulation/feed";
import type { SimClientConfig } from "../simulation/sim-client";
import { SimExchangeClient } from "../simulation/sim-client";

export function createExchangeClient(
  env: Env,
  platform: "polymarket" | "kalshi",
  simFeed?: { feed: PriceFeed; config?: Partial<Omit<SimClientConfig, "platform" | "feed">> }
): ExchangeClient {
  if (simFeed) {
    return new SimExchangeClient({
      platform,
      feed: simFeed.feed,
      simulatedNow: () => new Date().toISOString(),
      virtualBalance: simFeed.config?.virtualBalance ?? 1000,
      ...simFeed.config,
    });
  }
  // existing logic unchanged below...
}
```

### Test pattern: Polymarket 2% taker fee

```typescript
// test/core/sim-client.test.ts
import { describe, test, expect } from "bun:test";
import { generateScenario } from "../../src/worker/core/simulation/generator";
import { PriceFeed } from "../../src/worker/core/simulation/feed";
import { SimExchangeClient } from "../../src/worker/core/simulation/sim-client";

describe("EXCH-03 Polymarket taker fee", () => {
  test("taker order shows 2% less proceeds than fill price", async () => {
    const scenario = generateScenario({ type: "flat", seed: 42, ticks: 10 });
    const feed = new PriceFeed(scenario);
    const now = scenario.prices[5].timestamp;

    const client = new SimExchangeClient({
      platform: "polymarket",
      feed,
      simulatedNow: () => now,
      virtualBalance: 1000,
      takerFeeRate: 0.02,
      seed: 1,
    });

    // Place a taker order (postOnly not set)
    const result = await client.placeOrder({
      marketId: "sim-market",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 100,
    });

    expect(result.status).toBe("filled");
    // Net proceeds = filledSize * filledPrice = 100 * 0.5 = 50
    // Fee = 50 * 0.02 = 1
    // Total cost = 51; balance = 1000 - 51 = 949
    const balance = await client.getBalance();
    expect(balance).toBeCloseTo(949, 1);
  });
});
```

### Test pattern: Kalshi 1.75¢/contract cap

```typescript
describe("EXCH-04 Kalshi fee cap", () => {
  test("order at price 0.50 applies 1.75 cent/contract cap", async () => {
    // At P=0.5: fee = ceil(0.07 * 0.5 * 0.5 * 10000) / 10000 = 0.0175
    const scenario = generateScenario({ type: "flat", seed: 42, ticks: 10 });
    const feed = new PriceFeed(scenario);
    const now = scenario.prices[5].timestamp;

    const client = new SimExchangeClient({
      platform: "kalshi",
      feed,
      simulatedNow: () => now,
      virtualBalance: 1000,
      seed: 1,
    });

    const balanceBefore = await client.getBalance();
    await client.placeOrder({
      marketId: "sim-market",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 100, // 100 contracts
    });
    const balanceAfter = await client.getBalance();

    // Cost = 100 * 0.5 = 50 contracts value
    // Fee = 100 * 0.0175 = 1.75
    // Total deducted = 51.75
    expect(balanceBefore - balanceAfter).toBeCloseTo(51.75, 2);
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Mock client with fixed `status: "filled"` (Phase 1 `MockExchangeClient`) | `SimExchangeClient` with fee simulation, partial fills, balance tracking | Phase 3 enables meaningful backtest PnL calculation; Phase 1 mock was only for strategy flow testing |
| `simulatedNow` as a static value | `simulatedNow` as a getter function | Enables Phase 4 BacktestClock to advance time without reconstructing the client |
| No balance enforcement in mock | Virtual balance deducted on fill | EXCH-06 requirement satisfied; prevents strategies from over-trading in simulation |

**Deprecated/outdated in this project:**
- `MockExchangeClient` in `test/helpers/mocks.ts`: Still useful for strategy unit tests where fee accuracy doesn't matter. Not replaced — used alongside `SimExchangeClient`.

---

## Open Questions

1. **Polymarket fee rate for simulation**
   - What we know: REQUIREMENTS.md specifies 2% taker / 0% maker. Current live Polymarket fees are lower or zero for most markets.
   - What's unclear: Does the backtest planner want configurable fee rate (to test sensitivity) or a fixed 2%?
   - Recommendation: Make `takerFeeRate` configurable with 0.02 as default. This satisfies the requirement and allows future scenarios with different rate assumptions.

2. **Order book depth for getOrderBook**
   - What we know: Some strategies (market-maker) read multiple levels of the order book. The sim client synthesizes a 2-level book from the mid price.
   - What's unclear: How many levels does market-maker strategy actually consume?
   - Recommendation: Synthesize 3 levels per side with decreasing size. Can be expanded in Phase 4 if needed. This is not a blocker for EXCH-01 through EXCH-07.

3. **getMarkets pagination in simulation**
   - What we know: The `getMarkets` interface supports cursor-based pagination. The sim client only has one market per PriceFeed.
   - What's unclear: Will any strategy try to paginate beyond the first page in backtest?
   - Recommendation: Return `nextCursor: undefined` always. Strategies that paginate will get one page and stop. This is correct behavior for single-market simulation scenarios.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none — `bun test` discovers `**/*.test.ts` automatically |
| Quick run command | `bun test test/core/sim-client.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXCH-01 | SimExchangeClient type-checks as ExchangeClient (all 11 methods present) | unit (type-level) | `bun test test/core/sim-client.test.ts` | Wave 0 |
| EXCH-02 | getPrice returns only current-tick price; price at future tick not visible | unit | `bun test test/core/sim-client.test.ts` | Wave 0 |
| EXCH-03 | Taker order on Polymarket sim: balance decreases by cost + 2% fee | unit | `bun test test/core/sim-client.test.ts` | Wave 0 |
| EXCH-04 | Kalshi order at P=0.50 deducts exactly 1.75¢/contract | unit | `bun test test/core/sim-client.test.ts` | Wave 0 |
| EXCH-05 | n=200 orders at leg2FailRate=0.30 → roughly 30% failed (within ±10pp) | unit | `bun test test/core/sim-client.test.ts` | Wave 0 |
| EXCH-06 | Balance after orders equals startBalance minus cumulative fill costs and fees; order exceeding balance returns "failed" | unit | `bun test test/core/sim-client.test.ts` | Wave 0 |
| EXCH-07 | createExchangeClient with simulationFeed returns SimExchangeClient instance | unit | `bun test test/core/sim-client.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test test/core/sim-client.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/worker/core/simulation/sim-client.ts` — SimExchangeClient class + SimClientConfig interface
- [ ] `test/core/sim-client.test.ts` — covers EXCH-01 through EXCH-07
- [ ] `src/worker/core/exchanges/factory.ts` — extend with optional `simFeed` third parameter (modification, not new file)

*(Existing test infrastructure `test/helpers/db.ts`, `test/helpers/mocks.ts`, and Phase 2 simulation files all present — no additional setup gaps)*

---

## Sources

### Primary (HIGH confidence)
- Direct source inspection: `src/worker/core/exchanges/types.ts` — exact ExchangeClient interface (11 methods, 7 types)
- Direct source inspection: `src/worker/core/exchanges/factory.ts` — current factory signature, extension point identified
- Direct source inspection: `src/worker/core/simulation/feed.ts`, `types.ts`, `generator.ts` — Phase 2 output; PriceFeed API confirmed as `latestAt(simulatedNow: string)`
- Direct source inspection: `test/helpers/mocks.ts` — MockExchangeClient pattern; bun:test mock.module() pattern
- REQUIREMENTS.md line EXCH-03 — explicit 0% maker / 2% taker specification
- WebSearch cross-referenced: Kalshi taker fee formula `ceil(0.07 * C * P * (1-P))` confirmed by multiple academic papers and official fee schedule links (1.75¢/contract max at P=0.50)

### Secondary (MEDIUM confidence)
- WebFetch of `docs.polymarket.com/trading/fees` — confirms current live Polymarket fees are mostly zero or variable; legacy 2% taker rate is the simulation target per REQUIREMENTS.md
- WebSearch Kalshi fee schedule 2025/2026 — confirmed formula structure stable; maker fees added April 2025 but taker formula unchanged

### Tertiary (LOW confidence)
- Kalshi official PDF (`kalshi.com/docs/kalshi-fee-schedule.pdf`) — rate-limited at research time; formula verified via multiple secondary sources instead

---

## Metadata

**Confidence breakdown:**
- ExchangeClient interface (EXCH-01): HIGH — direct source inspection
- PriceFeed integration (EXCH-02): HIGH — Phase 2 tested and confirmed
- Polymarket fee rate (EXCH-03): HIGH for simulation parameter; MEDIUM for "matches live fees" (intentionally using spec-defined 2% not current live rate)
- Kalshi fee formula (EXCH-04): MEDIUM-HIGH — formula confirmed by 3+ sources; official PDF unavailable at research time
- Partial fill pattern (EXCH-05): HIGH — seeded PRNG approach is deterministic and testable
- Virtual balance (EXCH-06): HIGH — straightforward stateful deduction
- Factory extension (EXCH-07): HIGH — factory is 60 lines, extension point is clear

**Research date:** 2026-03-22
**Valid until:** 2026-06-22 (stable interfaces; fee schedules could change but simulation uses spec-defined values)
