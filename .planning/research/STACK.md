# Technology Stack — Simulation & Backtesting Layer

**Project:** trade-bot simulation/backtest/seeder milestone
**Researched:** 2026-03-21
**Scope:** New dependencies only — does not repeat the existing stack (Hono, React, Drizzle, viem, etc.)

---

## Context: What This Stack Extends

The existing project uses Bun as package manager and test runner (`bun test`), Wrangler 4.x for the Workers runtime, Drizzle ORM 0.38 with D1/SQLite, and TypeScript 5.7 strict mode. The simulation layer must slot into this environment without fighting it.

**Critical constraint:** Strategies run as Durable Objects in the Cloudflare Workers runtime. The backtest engine must run *outside* that runtime (as a Node/Bun CLI), injecting a mock `ExchangeClient` and a mock `BaseBotDO` that delegates to an in-memory SQLite database instead of D1.

---

## Recommended Stack

### Test Runner: Switch from Bun test to Vitest 4.x

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| vitest | ^4.1.0 | Unit test runner | Required by `@cloudflare/vitest-pool-workers`; has feature parity with bun test for this project; supports `bun` as runtime via `--pool=forks` |
| @cloudflare/vitest-pool-workers | ^0.13.3 | Run integration tests inside actual workerd runtime | Only official path to test Durable Objects, D1 bindings, and Cloudflare env in tests; provides `applyD1Migrations()` for seeding D1 in test |

**Confidence:** HIGH — Cloudflare's official recommended integration. Version 0.13.3 confirmed on npm registry (March 2026). Requires `vitest ^4.1.0` as peer dependency (confirmed).

**Why switch from `bun test`:** The existing `test` script is `bun test` with no existing test suite. The project needs `applyD1Migrations()` from `@cloudflare/vitest-pool-workers` for integration tests against local D1. Vitest 4.1 supports bun as the underlying runtime so existing scripts can be updated with minimal friction. This is a net-new test infrastructure, not a migration of existing tests.

**What NOT to use:** Jest — incompatible with Cloudflare's vitest pool; adds needless migration burden. The Bun built-in test runner — works for isolated unit tests but cannot run tests inside the workerd runtime or access `applyD1Migrations()`.

---

### In-Memory SQLite for Unit Tests: drizzle-orm/bun-sqlite

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| bun:sqlite (built-in) | Bun 1.x built-in | In-memory SQLite for unit tests | Already in the runtime; no install needed; `new Database(':memory:')` gives an isolated per-test DB; 3-6x faster than better-sqlite3 per Bun benchmarks |
| drizzle-orm/bun-sqlite | ^0.45.1 (drizzle-orm) | Drizzle adapter for bun:sqlite | Official adapter: `import { drizzle } from 'drizzle-orm/bun-sqlite'` — same Drizzle schema, same query API, different underlying driver |

**Usage pattern for unit tests:**
```typescript
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from '@worker/core/db/schema';

const sqlite = new Database(':memory:');
const db = drizzle({ client: sqlite, schema });
// Run migrations, then test strategy logic against db
```

**Confidence:** HIGH — Official Drizzle documentation confirms this pattern. Bun:sqlite is a first-class built-in; no native addon compatibility issues unlike better-sqlite3.

**Why NOT better-sqlite3:** Native addon compiled for Node.js ABI; incompatible with Bun without recompilation. The project uses Bun as package manager and runtime — fighting this mismatch is unnecessary when `bun:sqlite` is faster and built-in.

**Why NOT sql.js:** WebAssembly-based SQLite with no native speed; not needed when `bun:sqlite` is available. Only use case is browser environments.

**Why NOT libsql:** libsql-js aims for better-sqlite3 API compatibility but adds Turso-specific concepts (remote replicas) that are irrelevant here. `bun:sqlite` is simpler.

**Note on drizzle-orm version:** The existing project pins `^0.38.0`. The adapter for bun:sqlite (`drizzle-orm/bun-sqlite`) exists in that version. However, drizzle-orm 0.45.1 is current; upgrading is optional but the `bun-sqlite` driver path works at 0.38. Verify the driver entrypoint exists before upgrading: `ls node_modules/drizzle-orm/bun-sqlite`.

---

### Backtesting Engine: Custom Implementation (No External Framework)

**Recommendation:** Build the backtest engine in-house rather than adopting a backtesting library.

**Confidence:** HIGH — based on ecosystem survey.

**Why no external backtesting library:**

The TypeScript backtesting library ecosystem in 2026 is immature for prediction markets:

- **backtest-kit** (tripolskypetr/backtest-kit): Focused on crypto OHLCV candle data and technical indicators. Polymarket/Kalshi trade probability prices in 0–1 range, not candles. Imposing a candle abstraction on prediction market prices is an impedance mismatch.
- **Grademark**: Built on Data-Forge Notebook, opinionated data pipeline; adds ~2 library layers for no benefit when strategies are already implemented and the interface is fixed (`StrategyTickFn`).
- **backtestjs**: Fetches data from Binance; not prediction-market-aware.
- **WolfBot**: Full trading bot platform with MongoDB; far heavier than needed.

The project's key constraint is that strategies are already written as `StrategyTickFn = (bot: BaseBotDO, env: Env) => Promise<void>`. A backtesting framework assumes it drives execution — but here execution is already defined. The correct approach is a thin harness that:
1. Creates a `SimulatedExchangeClient` implementing `ExchangeClient`
2. Creates a `SimulatedBotDO` implementing the `BaseBotDO` interface
3. Iterates through time-series market data, calling each strategy's tick function
4. Records results into in-memory SQLite via Drizzle

This is ~200 lines of TypeScript, not a library integration.

---

### Performance Metrics: Custom Implementation

| Metric | Formula | Source |
|--------|---------|--------|
| PnL | `sum(realizedPnL)` + `sum(unrealizedPnL)` | Standard |
| Win Rate | `wins / (wins + losses)` | Standard |
| Sharpe Ratio | `mean(returns) / stddev(returns) * sqrt(periods_per_year)` | Industry standard; risk-free rate = 0 for prediction markets |
| Max Drawdown | `max((peak - trough) / peak)` across equity curve | Standard |
| Profit Factor | `grossProfit / grossLoss` | Standard supplement to Sharpe |

**Confidence:** HIGH — these formulas are unambiguous. The existing codebase already has Sharpe and drawdown implementations in `src/worker/core/risk/` — reuse those directly.

**What NOT to use:** `technicalindicators`, `tulind`, or similar — built for OHLCV candle data, not probability-based prediction market positions. No Sharpe library needed; the math is two lines.

---

### Market Data Generation: Custom Implementation

**Recommendation:** Implement market data generators as pure TypeScript functions producing data compatible with the existing `prices` table schema.

**Scenarios required (from PROJECT.md):**
- Bull trend: monotonically increasing probability with noise
- Bear trend: monotonically decreasing probability with noise
- Flat/mean-reversion: probability oscillates around 0.5
- Volatile: high-amplitude noise, no trend
- Crash: sharp probability collapse mid-series

**Generation approach:**
- Each scenario is a function `(marketId: string, ticks: number, seed: number) => PriceRow[]`
- Use a seeded pseudo-random number generator (PRNG) for reproducibility
- The `seed` parameter makes scenarios deterministic — same seed = same backtest

**PRNG library:**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| seedrandom | ^3.0.5 | Seeded PRNG | Tiny (1KB), no dependencies, well-maintained, produces reproducible sequences from a string seed; standard choice for deterministic simulation in JS/TS |

**Confidence:** MEDIUM — seedrandom is a long-standing library; alternatives like `@stdlib/random-base-mt19937` are heavier. The recommendation is based on ecosystem familiarity. Verify it works with Bun and ESM before adopting: `import seedrandom from 'seedrandom'` should work under `"type": "module"`.

**What NOT to use:** `Math.random()` — not seedable, non-reproducible backtests. `faker.js` — irrelevant abstraction for numeric time series.

---

### Real Market Data Capture: Official Exchange APIs (No New Libraries)

The existing `ExchangeClient` implementations already call Polymarket CLOB and Kalshi REST APIs. For data capture:

- **Polymarket historical prices:** `GET /prices-history` endpoint (documented at docs.polymarket.com/developers/CLOB/timeseries) — no additional library needed; existing `fetch` calls suffice
- **Kalshi historical trades:** Existing Kalshi REST client covers this
- **Capture script:** A Bun CLI script that calls the existing exchange clients, transforms responses into `prices` table rows, and bulk-inserts via Drizzle

**Confidence:** HIGH — Polymarket's CLOB API explicitly documents historical timeseries endpoints. No third-party data service needed.

**What NOT to use:** PredictionData.dev, FinFeedAPI, or similar paid data services — unnecessary cost and external dependency when the exchange APIs provide the data directly.

---

### CLI Report Output: cli-table3

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| cli-table3 | ^0.6.5 | Terminal table rendering for performance reports | TypeScript types included; actively maintained (successor to abandoned cli-table and cli-table2); supports column spanning, ANSI colors, alignment — sufficient for strategy comparison tables |

**Confidence:** HIGH — version 0.6.5 confirmed on npm registry. Standard choice confirmed by search.

**What NOT to use:** Ink (React-based terminal UI) — heavyweight for a report script; React renderer overhead for a table is not justified. `console.table()` — no column widths, no alignment control, not suitable for formatted performance reports.

---

### Seeder CLI: tsx (TypeScript execution)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| (none — use `bun run`) | — | Execute TypeScript CLI scripts | Bun executes `.ts` files natively with `bun run src/scripts/seed.ts`. No additional runner needed. |

The seeder, backtest CLI, and data capture scripts are TypeScript files executed directly with `bun run`. No `ts-node` or `tsx` needed.

**Confidence:** HIGH — Bun native TypeScript execution is a first-class feature.

---

## Full Dependency Delta

```bash
# Dev dependencies to add
bun add -d vitest @cloudflare/vitest-pool-workers @vitest/runner @vitest/snapshot

# Runtime dependencies to add
bun add seedrandom cli-table3
bun add -d @types/seedrandom
```

**Note on drizzle-orm upgrade:** Current project uses `^0.38.0`. The `drizzle-orm/bun-sqlite` adapter exists in 0.38 — no upgrade required. If the adapter entrypoint is missing in 0.38, upgrade to `^0.45.1` with `bun add drizzle-orm@latest drizzle-kit@latest`.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Test runner | vitest 4.x | bun test (existing) | Cannot access `applyD1Migrations()` or workerd runtime for integration tests |
| In-memory SQLite | bun:sqlite (built-in) | better-sqlite3 | Native addon ABI incompatibility with Bun; slower |
| In-memory SQLite | bun:sqlite (built-in) | sql.js | WebAssembly overhead; no advantage on Bun |
| Backtesting engine | Custom harness | backtest-kit / Grademark / backtestjs | Prediction market price data (0–1 probability) doesn't map to OHLCV candles; all frameworks assume they own execution loop, incompatible with existing `StrategyTickFn` |
| PRNG | seedrandom | @stdlib/random | Heavier dependency for no additional benefit |
| CLI output | cli-table3 | Ink (React terminal) | Overkill for a report script; no interactivity needed |
| Market data | Direct exchange APIs | PredictionData.dev / FinFeedAPI | External paid services unnecessary when exchange APIs expose history |

---

## Sources

- Cloudflare Workers Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/
- `@cloudflare/vitest-pool-workers` 0.13.3 (npm registry, verified March 2026): https://registry.npmjs.org/@cloudflare/vitest-pool-workers/latest
- `vitest` 4.1.0 latest (npm registry, verified March 2026)
- Drizzle ORM bun:sqlite connector: https://orm.drizzle.team/docs/connect-bun-sqlite
- Bun:sqlite native SQLite docs: https://bun.com/docs/runtime/sqlite
- Bun + better-sqlite3 ABI incompatibility discussion: https://github.com/oven-sh/bun/issues/16050
- `cli-table3` 0.6.5 (npm registry, verified March 2026): https://registry.npmjs.org/cli-table3/latest
- Polymarket historical timeseries API: https://docs.polymarket.com/developers/CLOB/timeseries
- Backtesting metrics reference: https://quantstrategy.io/blog/essential-backtesting-metrics-understanding-drawdown-sharpe/
- TypeScript backtesting libraries survey: https://github.com/topics/backtesting?l=typescript
