# Architecture

**Analysis Date:** 2026-03-21

## Pattern Overview

**Overall:** Cloudflare Workers monorepo with a React SPA frontend and a Hono API backend, both deployed as a single Worker. Trading bot logic runs inside Cloudflare Durable Objects using an alarm-driven tick loop. State is persisted in Cloudflare D1 (SQLite) via Drizzle ORM.

**Key Characteristics:**
- Single Worker serves both the static UI (`dist/ui/`) and the JSON API (`/api/*`)
- Each bot instance is a Durable Object (`BotDO`) with its own isolated storage and alarm scheduler
- All strategies are stateless tick functions loaded from a central registry; the single `BotDO` class handles all bot types
- Dual-platform trading: Polymarket (EVM/CLOB) and Kalshi (REST) share a unified `ExchangeClient` interface
- Risk layer (`PortfolioRisk`, Kelly criterion) is a pure service consumed by strategies; it does not own state

## Layers

**API Layer:**
- Purpose: HTTP routing, auth middleware, request/response serialization
- Location: `src/worker/index.ts`, `src/worker/api/routes/`
- Contains: Hono route handlers, one file per resource (bots, trades, markets, positions, analytics)
- Depends on: core/db, bots/base (for DO stubs)
- Used by: UI frontend, external callers

**Bot Orchestration Layer:**
- Purpose: Lifecycle management of trading bot Durable Objects (create, start, stop, status)
- Location: `src/worker/bots/base.ts`, `src/worker/bots/bot-do.ts`, `src/worker/bots/registry.ts`
- Contains: `BaseBotDO` abstract class, `BotDO` concrete class, strategy registry map
- Depends on: core/db (for heartbeat/audit writes), core/utils/logger
- Used by: API routes (`/api/bots/*/start`), Cloudflare alarm scheduler

**Strategy Layer:**
- Purpose: Strategy-specific trading logic executed once per tick
- Location: `src/worker/bots/<strategy-name>/strategy.ts` (one file per strategy)
- Contains: Pure async tick functions (`StrategyTickFn = (bot: BaseBotDO, env: Env) => Promise<void>`)
- Depends on: core/exchanges (factory + client), core/risk (portfolio + kelly), core/db, core/market
- Used by: `BotDO.tick()` via registry lookup

**Core / Infrastructure Layer:**
- Purpose: Shared services used by all strategies and routes
- Location: `src/worker/core/`
- Contains:
  - `core/db/` — Drizzle client factory and full schema
  - `core/exchanges/` — `ExchangeClient` interface, Polymarket + Kalshi clients, factory, websocket adapters
  - `core/market/` — `MarketMatcher` (cross-platform pair detection), `MarketResolver`, types
  - `core/risk/` — `PortfolioRisk` (exposure limits, circuit breaker), Kelly criterion functions, analytics (Sharpe, drawdown, PnL)
  - `core/utils/` — structured JSON `Logger`, `getConfig()` helper, `MetricsCollector`
- Depends on: D1 binding via `createDb(env.DB)`
- Used by: all strategies and API routes

**UI Layer:**
- Purpose: React SPA for monitoring and control
- Location: `src/ui/`
- Contains: React pages, TanStack Query hooks, a typed `api` client, shadcn/ui components
- Depends on: Worker API at `/api/*` (proxied via Vite dev server to `localhost:8787`)
- Used by: end users; built to `dist/ui/` and served as static assets by the Worker

## Data Flow

**Bot Tick Execution:**

1. Cloudflare alarm fires on `BotDO` instance at the configured `tickIntervalMs`
2. `BaseBotDO.alarm()` is invoked; calls `this.tick()` (abstract)
3. `BotDO.tick()` looks up the strategy by `config.botType` in the registry
4. Strategy tick function receives `(bot, env)` — creates a DB client and exchange clients from `env`
5. Strategy runs risk checks via `PortfolioRisk.checkTrade()` and `isDailyLossBreached()`
6. If approved, strategy calls `ExchangeClient.placeOrder()` against the exchange REST API
7. Strategy calls `bot.recordTrade()` (protected method on `BaseBotDO`) to persist order + trade + position to D1
8. `alarm()` writes heartbeat to `bot_instances` table and schedules next alarm

**API Request → Bot Start:**

1. `POST /api/bots/:id/start` is received by Hono route in `src/worker/api/routes/bots.ts`
2. Route retrieves `bot_instances` row from D1 to get `durableObjectId`
3. Route calls `env.BOT_DO.idFromString(durableObjectId)` to get a DO stub
4. Calls `stub.start(config)` RPC — `BotDO.start()` stores config in DO storage, sets first alarm
5. Route updates `bot_instances.status = 'running'` in D1

**UI Data Flow:**

1. React component mounts, TanStack Query hook fires `api.*` function
2. `src/ui/lib/api.ts` sends `fetch('/api/...')` request
3. Hono routes query D1 via Drizzle and return JSON
4. TanStack Query caches result (`staleTime: 10_000ms`) and re-fetches on interval

**State Management:**
- Server state: TanStack Query (no client-side state store)
- Bot runtime state: Durable Object storage (`ctx.storage.put/get`) for config and running flag
- Persistent state: Cloudflare D1 via Drizzle ORM

## Key Abstractions

**ExchangeClient Interface:**
- Purpose: Unified trading interface hiding platform differences between Polymarket and Kalshi
- Definition: `src/worker/core/exchanges/types.ts`
- Implementations: `src/worker/core/exchanges/polymarket/client.ts`, `src/worker/core/exchanges/kalshi/client.ts`
- Factory: `src/worker/core/exchanges/factory.ts` — `createExchangeClient(env, platform)`
- Pattern: Interface + factory, clients are constructed per-tick from env credentials

**BaseBotDO (Abstract Durable Object):**
- Purpose: Base class providing alarm loop, trade recording, position upsert, config persistence, and audit logging
- Location: `src/worker/bots/base.ts`
- Pattern: Template Method — `tick()` is abstract, `alarm()` is the algorithm; subclass (`BotDO`) provides implementation
- Exposes RPC methods: `start()`, `stop()`, `getStatus()`, `updateConfig()`

**StrategyTickFn:**
- Purpose: Type for all trading strategies — `(bot: BaseBotDO, env: Env) => Promise<void>`
- Definition: `src/worker/bots/registry.ts`
- Pattern: Strategy pattern — functions registered by string key, looked up at runtime
- All 8 strategies in `src/worker/bots/*/strategy.ts` conform to this type

**PortfolioRisk:**
- Purpose: Enforces position limits, max total exposure, per-trade max loss, max open positions, daily loss circuit breaker
- Location: `src/worker/core/risk/portfolio.ts`
- Pattern: Service class instantiated per-tick with a DB handle and limit overrides via `getLimitsForBot()`

**Database Schema (Drizzle/SQLite):**
- Purpose: Single source of truth for all persistent state
- Location: `src/worker/core/db/schema.ts`
- Tables: `markets`, `market_links`, `prices`, `bot_instances`, `orders`, `trades`, `positions`, `bot_metrics`, `tracked_traders`, `audit_log`
- Pattern: All timestamps stored as ISO-8601 text; JSON config columns use `{ mode: 'json' }` with TypeScript generics

## Entry Points

**Worker Entry Point:**
- Location: `src/worker/index.ts`
- Triggers: Every HTTP request to the Worker
- Responsibilities: Mounts CORS, auth (bearer token), and Hono route modules; re-exports `BotDO` for Wrangler binding registration

**UI Entry Point:**
- Location: `src/ui/main.tsx`
- Triggers: Browser load of `dist/ui/index.html`
- Responsibilities: Mounts React root, wraps app in `QueryClientProvider` and `BrowserRouter`

**Durable Object Entry Point:**
- Location: `src/worker/bots/bot-do.ts` (`BotDO` class), exported from `src/worker/index.ts`
- Triggers: DO instantiation via `env.BOT_DO.get(id)` RPC, or alarm firing
- Responsibilities: Hydrates config from DO storage on construction (`blockConcurrencyWhile`), delegates ticks to registered strategy

## Error Handling

**Strategy:** Errors in `BaseBotDO.alarm()` are caught, stored as `lastError` in memory and `error_message` in `bot_instances` table; the alarm loop continues (next alarm still scheduled). Errors inside strategy tick loops are caught per-item with `try/catch` and logged — a failing market pair does not abort the full tick.

**Patterns:**
- API routes use early-return `404` guards: `if (!bot) return c.json({ error: 'Not found' }, 404)`
- Exchange client errors during strategy init cause early return from tick (not a crash)
- Audit log failures are silently swallowed (`catch {}`) as non-critical
- Partial fill risk on multi-leg arb (cross-arb buy leg succeeds, sell leg fails) is logged as error but not rolled back — noted as a known concern

## Cross-Cutting Concerns

**Logging:** Structured JSON via `src/worker/core/utils/logger.ts`. `Logger` class accepts a context object at construction (e.g. `{ strategy: 'cross-arb' }`) and merges it into every log entry. All output is `console.log/warn/error` as JSON strings. Module-level logger instances are preferred: `const log = new Logger({ strategy: 'x' })`.

**Validation:** No input validation library detected. API routes do minimal runtime checking (existence checks, type coercions via `Number()`). Strategy configs are cast with `(bot as any).config as XConfig` — no runtime schema validation.

**Authentication:** Optional bearer token auth on all `/api/*` routes. If `AUTH_TOKEN` env var is not set, auth is skipped entirely (dev mode). Health check at `/api/health` is always unauthenticated.

---

*Architecture analysis: 2026-03-21*
