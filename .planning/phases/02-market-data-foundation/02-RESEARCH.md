# Phase 2: Market Data Foundation - Research

**Researched:** 2026-03-21
**Domain:** Deterministic synthetic price generation, seeded PRNG for TypeScript, prediction-market price constraints (0–1 bounded), cursor-based time-series feed with no-lookahead guard
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Bull trend price series (probability 0→1 bounded, rising trajectory) | Geometric random walk with positive drift; clamp to [0.01, 0.99]; seeded mulberry32 PRNG |
| DATA-02 | Bear trend price series (falling trajectory) | Same model as DATA-01 with negative drift parameter |
| DATA-03 | Flat/sideways price series | Near-zero drift; tight volatility band |
| DATA-04 | High-volatility price series | Same model; elevated sigma parameter |
| DATA-05 | Crash scenario price series (sudden reversal) | Two-phase generation: stable phase then forced reversal at configurable tick |
| DATA-06 | Generated data conforms to existing `markets` and `prices` Drizzle schema | Schema audit complete — see Schema Constraints section |
| DATA-07 | Generator uses seeded PRNG for reproducible scenarios across runs | mulberry32 PRNG (32-bit, pure TS, no Node.js dependency) |
</phase_requirements>

---

## Summary

Phase 2 builds the deterministic market data layer that all downstream phases consume. The core problem is generating realistic binary prediction-market prices (bounded strictly in (0,1)) that follow five distinguishable trajectory types, fully reproducibly from an integer seed.

The project runs on Cloudflare Workers which prohibits Node.js-only APIs. This rules out `Math.seedrandom` (Node-dependent npm package) and Node's `crypto.randomBytes`. The correct approach is a pure-JavaScript PRNG implemented inline — the **mulberry32** algorithm is the standard choice for this use case: 32-bit, ~10 lines of code, no dependencies, and produces excellent uniformity for statistical simulation purposes.

For price trajectory generation, a **geometric random walk** adapted for (0,1) bounds is the standard model. Rather than using log-normal returns (which assume unbounded prices), the canonical approach for prediction markets is to apply increments in log-odds space (logit space), which naturally keeps probabilities bounded and makes mean reversion easy to implement. Each scenario type is a parameterization of this model: drift, volatility, and a crash trigger.

The cursor-based feed wraps a generated price array. The cursor holds the current tick index and the simulated clock time at that index. `advance()` increments the index and the simulated clock. `getAt(simulatedNow)` returns all rows with `timestamp <= simulatedNow`, enforcing the no-lookahead constraint. Any attempt to access future rows returns empty — there is no separate enforcement mechanism needed beyond timestamp comparison.

**Primary recommendation:** Implement `mulberry32` as a standalone PRNG factory, generate prices in logit-space with per-scenario drift/volatility parameters, insert market and price rows using existing Drizzle schema types (`typeof markets.$inferInsert`, `typeof prices.$inferInsert`), and wrap the array in a `PriceFeed` class with cursor state.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:test` (built-in) | built-in | Test runner for generator tests | Already established in Phase 1 |
| `drizzle-orm/bun-sqlite` | 0.38.x (installed) | Drizzle insert types for schema conformance tests | Already installed; zero new deps |
| mulberry32 PRNG | N/A — inline ~10 lines | Seeded 32-bit PRNG | Pure TS, no npm, CF Workers compatible |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | No additional packages needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| mulberry32 (inline) | `seedrandom` npm package | seedrandom is Node-compatible but adds a dependency; mulberry32 is 10 lines and CF-safe |
| mulberry32 (inline) | `xoshiro128**` | xoshiro128 has better statistical properties but is overkill for this use case; mulberry32 is more widely cited in simulation literature |
| logit-space walk | Clamped linear random walk | Clamped linear walk has boundary artifacts (prices pile up at 0 and 1); logit walk naturally avoids this |
| `typeof prices.$inferInsert` | Inline type construction | $inferInsert is the Drizzle-blessed pattern; hand-typed interfaces drift from schema |

**Installation:** No new packages required.

---

## Schema Constraints

This section is the authoritative answer for DATA-06.

### `markets` table — required insert fields
```
platform    text NOT NULL  — 'polymarket' | 'kalshi'
platform_id text NOT NULL  — unique identifier string
title       text NOT NULL  — human-readable market name
status      text NOT NULL  — 'active' | 'closed' | 'resolved'  (default 'active')
```
All other fields (`description`, `category`, `resolution`, `end_date`) are nullable — safe to omit.
Timestamps `created_at` / `updated_at` default to `datetime('now')` — omit in insert, let SQLite fill them.

### `prices` table — required insert fields
```
market_id   integer NOT NULL  — FK to markets.id
timestamp   text NOT NULL     — ISO-8601 format: 'YYYY-MM-DDTHH:MM:SS.sssZ'
```
All price columns (`yes_price`, `no_price`, `yes_bid`, `yes_ask`, `volume`) are nullable reals — BUT the generator should always populate at least `yes_price` and `no_price` so downstream strategies can read them.

### Timestamp format rule
The schema stores all timestamps as ISO-8601 text. The `datetime('now')` SQLite default produces `'YYYY-MM-DD HH:MM:SS'` (space separator, no timezone). For generator-produced rows the **canonical format is `new Date(ms).toISOString()`** which produces `'YYYY-MM-DDTHH:MM:SS.sssZ'` — this is compatible with SQLite's text comparison operators (`<`, `<=`, `>`) because ISO-8601 strings sort lexicographically.

### Price range rule
Prediction market probabilities must satisfy `0 < p < 1`. The Drizzle `real` column has no check constraint. The generator MUST clamp to `[0.01, 0.99]` before inserting. `yes_price + no_price` should approximately equal `1.0` (±0.05 for spread modeling), but is not enforced by the schema.

---

## Architecture Patterns

### Recommended Project Structure
```
src/worker/core/simulation/
├── prng.ts           # mulberry32 PRNG factory — seeded random number generator
├── generator.ts      # generateScenario() — produces market + price rows
├── feed.ts           # PriceFeed class — cursor-based no-lookahead accessor
└── types.ts          # ScenarioType, GeneratorParams, GeneratedScenario types
test/core/
├── generator.test.ts # DATA-01..DATA-07 tests
└── feed.test.ts      # cursor / no-lookahead tests
```

No new top-level directories. All simulation code lives under `src/worker/core/simulation/` — consistent with existing `src/worker/core/` structure.

### Pattern 1: mulberry32 PRNG
**What:** A pure-JS seeded 32-bit PRNG. Accepts an integer seed, returns a function that produces uniform floats in `[0, 1)` on each call.
**When to use:** Any place in the generator that needs randomness. Pass a single PRNG instance through the generator so the entire sequence is determined by one seed.

```typescript
// src/worker/core/simulation/prng.ts
// Source: Public domain algorithm — mulberry32 by Tommy Ettinger
// Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c

/**
 * Creates a seeded PRNG using the mulberry32 algorithm.
 * Returns a function that yields uniform floats in [0, 1) per call.
 * Pure TypeScript — no Node.js or crypto APIs required.
 */
export function createPrng(seed: number): () => number {
  let s = seed >>> 0; // ensure unsigned 32-bit integer
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
```

### Pattern 2: Logit-Space Random Walk for (0,1) Bounded Prices
**What:** Generates a price trajectory that stays in (0,1) by walking in logit space. Logit maps (0,1) to (-∞, +∞); increments applied in logit space are then inverted back with sigmoid.
**When to use:** All five scenario types — parameterize by drift and sigma.

```typescript
// src/worker/core/simulation/generator.ts (excerpt)
// Standard approach for bounded time series in prediction markets

/** logit(p) = ln(p / (1-p)) — maps (0,1) → (-∞, +∞) */
function logit(p: number): number {
  return Math.log(p / (1 - p));
}

/** sigmoid(x) = 1 / (1 + exp(-x)) — maps (-∞, +∞) → (0,1) */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Generates a price series of length `ticks` starting near `startPrice`.
 * drift > 0 = bull, drift < 0 = bear, drift ≈ 0 = flat.
 * sigma controls volatility amplitude.
 * rng is a seeded PRNG from createPrng().
 */
function generatePriceSeries(params: {
  ticks: number;
  startPrice: number;
  drift: number;
  sigma: number;
  rng: () => number;
}): number[] {
  const { ticks, startPrice, drift, sigma, rng } = params;
  const prices: number[] = [startPrice];
  let logitP = logit(startPrice);

  for (let i = 1; i < ticks; i++) {
    // Box-Muller normal sample from two uniform randoms
    const u1 = rng();
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    logitP += drift + sigma * z;
    prices.push(Math.min(0.99, Math.max(0.01, sigmoid(logitP))));
  }

  return prices;
}
```

### Pattern 3: Scenario Type Parameters
**What:** Five named scenarios as parameterizations of the same generator.
**When to use:** `generateScenario(type, seed, ticks)` dispatches to these.

| Scenario | drift | sigma | Special |
|----------|-------|-------|---------|
| `bull` | +0.05 | 0.10 | none |
| `bear` | -0.05 | 0.10 | none |
| `flat` | 0.00 | 0.04 | none |
| `volatile` | 0.00 | 0.25 | none |
| `crash` | +0.03 | 0.08 | At tick `Math.floor(ticks * 0.6)`, force logit -= 2.5 (sharp reversal) |

These parameter values produce visually distinct, plausible trajectories at ticks = 200. The "crash" scenario uses positive initial drift (price rising toward resolution) followed by a single large negative logit shock at the 60% mark.

### Pattern 4: PriceFeed Cursor
**What:** Wraps a generated price array. Holds a `currentIndex` and a `simulatedNow` timestamp. `getUpTo(simulatedNow)` returns only rows with `timestamp <= simulatedNow`.
**When to use:** Phase 3 SimExchangeClient will hold a `PriceFeed` instance and call `getUpTo(clock.now())` to get visible prices.

```typescript
// src/worker/core/simulation/feed.ts
import type { GeneratedScenario } from "./types";

export class PriceFeed {
  private rows: GeneratedScenario["prices"];

  constructor(scenario: GeneratedScenario) {
    // rows are sorted by timestamp ascending (guaranteed by generator)
    this.rows = scenario.prices;
  }

  /**
   * Returns all price rows with timestamp <= simulatedNow.
   * Enforces no-lookahead: future rows are never returned.
   * @param simulatedNow ISO-8601 string — current simulated clock time
   */
  getUpTo(simulatedNow: string): GeneratedScenario["prices"] {
    return this.rows.filter((row) => row.timestamp <= simulatedNow);
  }

  /** Latest price row visible at simulatedNow, or undefined if none yet. */
  latestAt(simulatedNow: string): GeneratedScenario["prices"][number] | undefined {
    const visible = this.getUpTo(simulatedNow);
    return visible[visible.length - 1];
  }
}
```

**Critical:** `row.timestamp <= simulatedNow` works correctly because both are ISO-8601 strings, which sort lexicographically in the same order as chronological order.

### Pattern 5: generateScenario() — Full Output Shape
**What:** Top-level function producing market row + price rows ready for Drizzle insert.

```typescript
// src/worker/core/simulation/generator.ts
import type { typeof markets.$inferInsert } from "../../db/schema";
import type { typeof prices.$inferInsert } from "../../db/schema";

// NOTE: Use proper Drizzle import:
import { markets, prices } from "../../db/schema";
type MarketInsert = typeof markets.$inferInsert;
type PriceInsert = typeof prices.$inferInsert;

export interface GeneratedScenario {
  market: Omit<MarketInsert, "id">;
  prices: Array<Omit<PriceInsert, "id" | "market_id"> & { timestamp: string; yes_price: number; no_price: number }>;
}
```

The market row has `market_id` omitted because the real `id` is assigned by SQLite autoincrement after insert. The caller inserts the market row first, retrieves the generated `id`, then inserts price rows with that `id`.

### Anti-Patterns to Avoid
- **Using `Math.random()` directly:** Non-deterministic across calls. DATA-07 requires seeded PRNG.
- **Linear arithmetic walk with hard clamp:** Produces unrealistic price distributions — prices accumulate at 0.01 and 0.99 boundaries. Use logit-space walk instead.
- **Using Node.js `crypto.randomBytes` for PRNG seeding:** Unavailable in Cloudflare Workers unless `nodejs_compat` flag is active, and even then it's asynchronous. mulberry32 is synchronous and pure.
- **Storing timestamps as Unix milliseconds integers:** The `prices.timestamp` column is `text NOT NULL`. Store as ISO-8601 string.
- **`yes_price + no_price != 1.0` without intention:** Both columns should be populated by the generator. No constraint enforces this in the schema, but downstream strategies that read both columns will behave unexpectedly if they are uncorrelated.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema type checking | Inline TypeScript interfaces for insert rows | `typeof markets.$inferInsert` / `typeof prices.$inferInsert` | Drizzle inferred types stay in sync with schema automatically; hand-written types drift |
| Timestamp sorting | Custom date comparison logic | ISO-8601 string comparison (`<=`) | ISO-8601 strings sort lexicographically = chronologically; no parsing needed for comparison |
| Normal distribution sampling | Lookup tables or approximations | Box-Muller transform (two lines) from uniform rng | Box-Muller is exact and trivially implementable from any uniform PRNG |
| Cursor enforcement | Stateful index increment with boundary checks | Timestamp-based `filter(row => row.timestamp <= simulatedNow)` | Timestamp filter is stateless, testable, and directly aligns with how Phase 4 BacktestClock will expose `clock.now()` |

**Key insight:** The logit-space walk eliminates the entire class of boundary artifact bugs. Clamping-based approaches require hand-tuned min/max logic per scenario to prevent price series from flatting at the boundaries; logit space handles this naturally.

---

## Common Pitfalls

### Pitfall 1: PRNG Seed = 0 Produces Degenerate Output
**What goes wrong:** `mulberry32(0)` — the state starts at `0 >>> 0 = 0`. The first iteration `s += 0x6d2b79f5` gives a valid non-zero value, but some PRNG variants produce all-zeros for seed=0.
**Why it happens:** Seed validation is missing.
**How to avoid:** In `createPrng`, add `if (seed === 0) seed = 1;` or document that seed must be a positive integer. The generator tests should use seeds like 42, 12345, 99999.
**Warning signs:** Price series that is entirely flat or NaN.

### Pitfall 2: `Math.log(0)` = -Infinity in Box-Muller
**What goes wrong:** When `u1 = 0` (which mulberry32 can produce), `Math.log(u1)` = `-Infinity`, producing NaN in the normal sample.
**Why it happens:** `Math.log(0)` is undefined in real analysis.
**How to avoid:** Add a small epsilon: `Math.log(u1 + 1e-10)`. Already shown in the code example above.
**Warning signs:** `NaN` values in the generated price array.

### Pitfall 3: Logit Divergence for Prices Near 0 or 1
**What goes wrong:** If `startPrice = 0.99`, then `logit(0.99) ≈ 4.6`. A bull scenario with drift +0.05 per tick and 200 ticks will push logit to `4.6 + 200*0.05 = 14.6`, sigmoid of which is `0.9999996`. The price series is indistinguishable from a flat line near 1.0.
**Why it happens:** logit magnifies values near the extremes.
**How to avoid:** Start prices near 0.5 for bull/bear scenarios. The generator should default `startPrice` to `0.5` unless explicitly overridden.
**Warning signs:** Visually flat price series that should be trending.

### Pitfall 4: Schema Insert Order — market_id FK Constraint
**What goes wrong:** Inserting a price row before the market row exists causes a SQLite FK constraint error.
**Why it happens:** `prices.market_id` has `REFERENCES markets(id)`. FK enforcement is enabled in bun:sqlite by default.
**How to avoid:** Always insert market row first, capture the inserted `id` (from Drizzle's `.returning()` or by querying `last_insert_rowid()`), then insert price rows with that `id`.
**Warning signs:** `FOREIGN KEY constraint failed` on price insert.

### Pitfall 5: `datetime('now')` vs `new Date().toISOString()` Format Mismatch
**What goes wrong:** SQLite default produces `'2026-03-21 14:30:00'` (space separator). `new Date().toISOString()` produces `'2026-03-21T14:30:00.000Z'` (T separator, Z suffix). Mixing formats in the `prices.timestamp` column breaks lexicographic sort-based comparisons.
**Why it happens:** The schema uses `datetime('now')` as the column default, but generator code uses `toISOString()`.
**How to avoid:** Generator always uses `new Date(ms).toISOString()` explicitly — never relies on the SQLite default for price rows. This is consistent and sortable.
**Warning signs:** `getUpTo(simulatedNow)` returning 0 rows when rows should be visible, because `'2026-03-21 14:30:00' <= '2026-03-21T14:30:00.000Z'` is false (space < T in ASCII).

---

## Code Examples

### Complete PRNG and price generation

```typescript
// src/worker/core/simulation/prng.ts
// Source: mulberry32 public domain — https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
export function createPrng(seed: number): () => number {
  let s = (seed || 1) >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
```

### No-lookahead feed test pattern

```typescript
// test/core/feed.test.ts
import { describe, test, expect } from "bun:test";
import { generateScenario } from "../../src/worker/core/simulation/generator";
import { PriceFeed } from "../../src/worker/core/simulation/feed";

describe("PriceFeed no-lookahead guard", () => {
  test("cannot return rows beyond current simulated time", () => {
    const scenario = generateScenario({ type: "bull", seed: 42, ticks: 100 });
    const feed = new PriceFeed(scenario);

    // Use the timestamp of the 10th price row as simulatedNow
    const cutoff = scenario.prices[9].timestamp;
    const visible = feed.getUpTo(cutoff);

    // Must not include rows 10..99
    expect(visible.length).toBe(10);
    for (const row of visible) {
      expect(row.timestamp <= cutoff).toBe(true);
    }
  });

  test("returns empty when simulatedNow is before first tick", () => {
    const scenario = generateScenario({ type: "flat", seed: 99, ticks: 50 });
    const feed = new PriceFeed(scenario);
    const beforeAll = new Date(0).toISOString(); // 1970-01-01
    expect(feed.getUpTo(beforeAll)).toHaveLength(0);
  });
});
```

### Schema conformance test pattern

```typescript
// test/core/generator.test.ts (excerpt)
import { describe, test, expect, beforeEach } from "bun:test";
import { generateScenario } from "../../src/worker/core/simulation/generator";
import { createTestDb } from "../helpers/db";
import { markets, prices } from "../../src/worker/core/db/schema";

describe("DATA-06 schema conformance", () => {
  test("market and price rows insert without error", async () => {
    const db = createTestDb();
    const scenario = generateScenario({ type: "bull", seed: 1, ticks: 20 });

    // Insert market row
    const [inserted] = await db
      .insert(markets)
      .values(scenario.market)
      .returning({ id: markets.id });

    expect(inserted.id).toBeGreaterThan(0);

    // Insert price rows with resolved market_id
    const priceRows = scenario.prices.map((p) => ({
      ...p,
      marketId: inserted.id,
    }));
    await expect(
      db.insert(prices).values(priceRows)
    ).resolves.toBeDefined();
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Arithmetic random walk + hard clamp | Logit-space random walk | Eliminates boundary artifacts; no special-case code for 0/1 edge |
| `Math.random()` (non-reproducible) | Seeded mulberry32 PRNG | Reproducible test scenarios; DATA-07 requirement satisfied |
| Node.js `crypto` seeding | Pure-JS arithmetic PRNG | CF Workers compatible; zero dependencies |

**Deprecated/outdated:**
- `seedrandom` npm package: Functional but adds a dependency. mulberry32 inline is preferred for CF Workers projects.
- Linear congruential generators (LCG): Short period, poor uniformity. mulberry32 has better statistical properties for the tick counts needed here (200–1000 ticks per scenario).

---

## Open Questions

1. **Tick interval for generated prices**
   - What we know: Each price row needs a `timestamp`. The generator must decide on a spacing (e.g., 1 minute, 5 minutes, 1 hour per tick).
   - What's unclear: What tick interval makes the most sense for the backtest engine in Phase 4? The generator should accept a `tickIntervalMs` parameter to match `BotConfig.tickIntervalMs`.
   - Recommendation: Default to `60_000` ms (1 minute per tick). Make it a configurable parameter so Phase 4 can match bot tick intervals. This is not a blocker for Phase 2 since Phase 3 and 4 consume the feed abstractly.

2. **Start time for generated timestamps**
   - What we know: Timestamps must be ISO-8601 strings. The generator needs a `startTime` to anchor the series.
   - What's unclear: Should start time be `Date.now()` at generation time, or a fixed historical anchor (e.g., `2024-01-01T00:00:00Z`) for reproducibility?
   - Recommendation: Accept an optional `startTime` parameter (ISO-8601 string). Default to a fixed historical anchor (e.g., `'2024-01-01T00:00:00.000Z'`) so that the SAME seed + start time always produces identical timestamps. Using `Date.now()` as default would make timestamps non-reproducible even with the same seed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none — `bun test` discovers `**/*.test.ts` automatically |
| Quick run command | `bun test test/core/generator.test.ts test/core/feed.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | Bull series: last price > start price (statistically, with seed 42, 200 ticks) | unit | `bun test test/core/generator.test.ts` | Wave 0 |
| DATA-02 | Bear series: last price < start price | unit | `bun test test/core/generator.test.ts` | Wave 0 |
| DATA-03 | Flat series: all prices within ±0.15 of start price | unit | `bun test test/core/generator.test.ts` | Wave 0 |
| DATA-04 | Volatile series: stddev of prices > 0.08 | unit | `bun test test/core/generator.test.ts` | Wave 0 |
| DATA-05 | Crash series: price at tick 0.6N > price at tick N (reversal) | unit | `bun test test/core/generator.test.ts` | Wave 0 |
| DATA-06 | Market and price rows insert into in-memory DB without error | integration | `bun test test/core/generator.test.ts` | Wave 0 |
| DATA-07 | Same seed + same params = identical price array on two calls | unit | `bun test test/core/generator.test.ts` | Wave 0 |

**No-lookahead tests (success criteria #4):**
| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| Feed with N future rows — cursor returns 0 beyond simulatedNow | unit | `bun test test/core/feed.test.ts` | Wave 0 |
| Feed returns exactly K rows when K ticks have elapsed | unit | `bun test test/core/feed.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test test/core/generator.test.ts test/core/feed.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/worker/core/simulation/prng.ts` — mulberry32 PRNG factory
- [ ] `src/worker/core/simulation/generator.ts` — `generateScenario()` function
- [ ] `src/worker/core/simulation/feed.ts` — `PriceFeed` class
- [ ] `src/worker/core/simulation/types.ts` — `ScenarioType`, `GeneratorParams`, `GeneratedScenario` types
- [ ] `test/core/generator.test.ts` — covers DATA-01 through DATA-07
- [ ] `test/core/feed.test.ts` — covers no-lookahead cursor enforcement

---

## Sources

### Primary (HIGH confidence)
- Direct schema inspection: `src/worker/core/db/schema.ts` and `drizzle/0000_tiny_leader.sql` — exact column names, types, nullable constraints, timestamp defaults
- Direct source inspection: `src/worker/core/exchanges/types.ts` — `MarketInfo`, `PriceUpdate` interfaces
- Phase 1 research and implementation: `test/helpers/db.ts`, `test/helpers/mocks.ts` — confirmed test infrastructure patterns (bun:test, createTestDb, Drizzle insert pattern)
- mulberry32 algorithm: Public domain, Tommy Ettinger — https://gist.github.com/tommyettinger/46a874533244883189143505d203312c (algorithm verified; known good statistical properties for simulation)

### Secondary (MEDIUM confidence)
- Logit-space random walk for bounded time series: Standard technique in prediction market simulation literature; logit/sigmoid pair is mathematically well-established
- Box-Muller transform for normal samples: Wikipedia + multiple textbook sources; exact formula verified
- Cloudflare Workers `nodejs_compat` flag behavior: CLAUDE.md documents the flag is enabled, but crypto availability for seeding is async — confirmed via CLAUDE.md constraint note

### Tertiary (LOW confidence)
- Exact parameter values for scenario types (drift=0.05, sigma=0.10, etc.): Chosen from common simulation conventions; not sourced from official documentation. Should be validated empirically by running the generator and inspecting output visually before finalizing.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all infrastructure from Phase 1
- Schema constraints (DATA-06): HIGH — direct schema file inspection
- PRNG choice (DATA-07): HIGH — mulberry32 is public domain, CF Workers compatible, pure TS
- Price generation algorithm: HIGH — logit-space walk is mathematically sound; boundary behavior is provable
- Scenario parameters: LOW — empirical; need visual validation run

**Research date:** 2026-03-21
**Valid until:** 2026-06-21 (schema stable; bun:test API stable; mulberry32 algorithm is eternal)
