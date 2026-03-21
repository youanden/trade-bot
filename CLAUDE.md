<!-- GSD:project-start source:PROJECT.md -->
## Project

**Trade Bot — Simulation & Testing**

A simulation and testing layer for an existing Cloudflare Workers trading bot platform. Adds seeders that populate all 8 bot types with realistic configurations, market data, and trade history, plus a backtest engine and paper trading mode to evaluate strategy performance across different market conditions. Results are reported via CLI.

**Core Value:** Confidently evaluate and compare all 8 trading strategies against realistic market scenarios before risking real capital.

### Constraints

- **Runtime**: Must work within Cloudflare Workers constraints (no Node.js-only APIs in production code)
- **Testing Runtime**: Vitest + in-memory SQLite for unit tests, Wrangler dev for integration
- **Data**: Market data generators must produce data compatible with existing `markets`, `prices`, and exchange response schemas
- **Strategy Interface**: Simulation must exercise strategies through their existing `StrategyTickFn` interface without modification
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.7 - All source code (worker and UI), strict mode enabled, ES2022 target
- None detected (pure TypeScript project)
## Runtime
- Cloudflare Workers (via Wrangler 4.x) - primary server runtime
- Node.js compat layer enabled via `nodejs_compat` compatibility flag
- Browser (via Vite) - React UI
- Bun (lockfile `bun.lock` present)
- Lockfile: present
## Frameworks
- Hono 4.7 - HTTP framework for Cloudflare Workers API server (`src/worker/index.ts`)
- React 19.0 - UI framework (`src/ui/`)
- React Router DOM 7.1 - Client-side routing (`src/ui/App.tsx`)
- Drizzle ORM 0.38 - SQLite ORM for Cloudflare D1 (`src/worker/core/db/`)
- Bun test runner (built-in) - test files in `test/`
- Vite 6.1 - UI dev server and bundler (`vite.config.ts`)
- Wrangler 4.0 - Cloudflare Workers dev server and deploy tool
## Key Dependencies
- `viem` 2.47 - Ethereum/EVM library used for EIP-712 order signing and Polygon wallet interaction for Polymarket (`src/worker/core/exchanges/polymarket/client.ts`)
- `drizzle-orm` 0.38 - Database access layer for all persistence (`src/worker/core/db/`)
- `hono` 4.7 - API server framework, used for routing, CORS, bearer auth middleware (`src/worker/index.ts`)
- `@tanstack/react-query` 5.64 - Server state management and data fetching hooks (`src/ui/hooks/`)
- `recharts` 2.15 - Charting library used in Analytics page (`src/ui/pages/Analytics.tsx`)
- `lucide-react` 0.474 - Icon library
- `tailwindcss` 4.0 - CSS utility framework (`src/ui/globals.css`, via `@tailwindcss/vite` plugin)
- `class-variance-authority` 0.7 - Variant-based className composition (`src/ui/lib/utils.ts`)
- `clsx` + `tailwind-merge` - Class name utilities
- `@cloudflare/workers-types` 4.x - TypeScript types for Cloudflare bindings (D1, Durable Objects, AI)
## Configuration
- All secrets injected via Cloudflare Workers env bindings (defined in `env.d.ts`)
- Required secrets: `POLYMARKET_API_KEY`, `POLYMARKET_PRIVATE_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PASSPHRASE`, `POLYMARKET_ADDRESS`, `KALSHI_API_KEY`, `KALSHI_API_SECRET`
- Optional: `AUTH_TOKEN` (skips bearer auth if absent — dev mode)
- `ENVIRONMENT` var defaults to `"development"`
- Path aliases: `@worker/*` → `./src/worker/*`, `@ui/*` → `./src/ui/*`
- Config: `tsconfig.json`
- `vite.config.ts` - UI build, outputs to `dist/ui/`, proxies `/api` to `localhost:8787` in dev
- `wrangler.toml` - Worker entry point `src/worker/index.ts`, assets served from `./dist/ui`
- `drizzle.config.ts` - Schema at `src/worker/core/db/schema.ts`, dialect SQLite, migrations in `drizzle/`
## Platform Requirements
- Bun runtime
- Wrangler CLI for Worker dev server (`wrangler dev` on port 8787)
- Vite dev server (`vite dev`) with API proxy to Worker
- Cloudflare Workers platform
- Cloudflare D1 (SQLite-compatible managed database) — database name `trade-bot-db`
- Cloudflare Durable Objects — `BotDO` class for stateful bot execution
- Cloudflare AI binding — `env.AI` used by LLM-based strategies
- Static assets served from Cloudflare CDN (`dist/ui/`)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Worker source files: `camelCase.ts` for utilities/clients (e.g., `client.ts`, `schema.ts`, `kelly.ts`)
- Strategy files: `strategy.ts` and `config.ts` per bot subdirectory
- React components: `PascalCase.tsx` (e.g., `Dashboard.tsx`, `BotDetail.tsx`)
- React hooks: `camelCase.ts` prefixed with `use` (e.g., `useBots.ts`, `useMarkets.ts`)
- Test files: `camelCase.test.ts` (e.g., `kelly.test.ts`, `analytics.test.ts`)
- Exported pure functions: `camelCase` (e.g., `kellyFraction`, `calculateSharpe`, `createExchangeClient`)
- Strategy tick functions: `{botType}Tick` pattern (e.g., `crossArbTick`, `marketMakerTick`, `copyTraderTick`)
- Internal/private helpers: `camelCase` (e.g., `titleSimilarity`, `tokenize`, `makeMarket`)
- Locals and parameters: `camelCase`
- Constants/config: `UPPER_SNAKE_CASE` for true module-level constants (e.g., `DEFAULT_LIMITS`, `LEVEL_PRIORITY`, `KALSHI_URLS`)
- DB query intermediates: descriptive camelCase (e.g., `openPositions`, `botTrades`, `linkedIds`)
- Interfaces: `PascalCase` prefixed descriptively (e.g., `BotConfig`, `TradeRecord`, `RiskCheck`, `KellyParams`)
- Type aliases: `PascalCase` (e.g., `LogLevel`, `StrategyTickFn`, `Database`)
- Enum-like string unions: inline literals, not enums (e.g., `"polymarket" | "kalshi"`, `"buy" | "sell"`)
- Drizzle inferred types: `typeof table.$inferSelect` pattern (e.g., `typeof markets.$inferSelect`)
- `PascalCase` with descriptive suffix (e.g., `KalshiClient`, `PortfolioRisk`, `MarketMatcher`, `Logger`, `BaseBotDO`)
- Abstract base classes suffixed with `DO` for Durable Objects (e.g., `BaseBotDO`)
## Code Style
- No formatter config file detected (no `.prettierrc`, `biome.json`, or `eslint.config.*`)
- Observed style: 2-space indentation, double quotes for strings, trailing commas in multi-line structures
- Line length: approximately 80-100 characters before wrapping
- Template literals used for string interpolation (e.g., `` `$${cost.toFixed(2)}` ``)
- No ESLint config detected
- TypeScript strict mode enforced via `tsconfig.json` (`"strict": true`)
- `isolatedModules: true` set, requiring explicit type imports (`import type { ... }`)
- All `import type` syntax used where only types are needed (e.g., `import type { ExchangeClient } from "../types"`)
- Error values narrowed via `err instanceof Error ? err.message : String(err)` pattern
- Optional chaining used extensively (e.g., `bot.config?.dbBotId`, `orderBook.bids[0]?.price ?? 0`)
- Nullish coalescing used for defaults (e.g., `?? 0`, `?? []`, `?? "unknown"`)
## Import Organization
- `@worker/*` → `./src/worker/*`
- `@ui/*` → `./src/ui/*`
- Note: aliases are defined but actual usage relies on relative paths in practice
- Always use `import type { ... }` for type-only imports (enforced by `isolatedModules`)
## Error Handling
## Logging
- Module-level logger instantiation with context object:
- Child loggers for additional context:
## Comments
- JSDoc blocks on exported functions with non-obvious parameters using `@param` tags
- Single-line `//` comments for algorithm steps numbered inline (e.g., `// 1. Get order book and calculate midpoint`)
- Inline comments on schema fields explaining allowed values (e.g., `// 'polymarket' | 'kalshi'`)
- Class-level JSDoc explaining high-level purpose
## Function Design
- Single object params for functions with 3+ args (e.g., `kellySize(params: KellyParams)`)
- Individual positional params for 1-2 args (e.g., `kellyFraction(probability, marketPrice)`)
- Optional params use `?` suffix in interface, not overloading
- Async functions return `Promise<T>` with explicit T
- No implicit `any` returns; return types annotated on public functions
- Result objects used for multi-value returns (e.g., `RiskCheck` with `allowed`, `reason`, `suggestedSize`)
## Module Design
- Named exports only — no default exports observed anywhere in the codebase
- Each module exports related functions/classes; no barrel index files
- Worker code under `src/worker/` — never imports from `src/ui/`
- UI code under `src/ui/` — communicates with worker only via HTTP API (`src/ui/lib/api.ts`)
- Shared types: none — types are duplicated between layers as needed
## React Conventions
- Named function exports (not arrow function exports) for page-level components: `export function Dashboard()`
- Sub-components co-located in the same file if small and page-specific (e.g., `StatusCard`, `BotCard` inside `Dashboard.tsx`)
- Props typed inline with destructuring: `function BotCard({ bot, onStart, ... }: { bot: any; onStart: () => void; ... })`
- One hook per file in `src/ui/hooks/`
- Thin wrappers around React Query (`useQuery`/`useMutation`) — no local state in data hooks
- Cache invalidation on mutations via `qc.invalidateQueries`
- Polling via `refetchInterval` option (e.g., 5000ms for bot status)
- Tailwind CSS utility classes only — no CSS modules, no inline `style` props
- `cn()` utility from `src/ui/lib/utils.ts` for conditional class merging (`clsx` + `tailwind-merge`)
- Tailwind v4 with `@tailwindcss/vite` plugin — no `tailwind.config.js`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Single Worker serves both the static UI (`dist/ui/`) and the JSON API (`/api/*`)
- Each bot instance is a Durable Object (`BotDO`) with its own isolated storage and alarm scheduler
- All strategies are stateless tick functions loaded from a central registry; the single `BotDO` class handles all bot types
- Dual-platform trading: Polymarket (EVM/CLOB) and Kalshi (REST) share a unified `ExchangeClient` interface
- Risk layer (`PortfolioRisk`, Kelly criterion) is a pure service consumed by strategies; it does not own state
## Layers
- Purpose: HTTP routing, auth middleware, request/response serialization
- Location: `src/worker/index.ts`, `src/worker/api/routes/`
- Contains: Hono route handlers, one file per resource (bots, trades, markets, positions, analytics)
- Depends on: core/db, bots/base (for DO stubs)
- Used by: UI frontend, external callers
- Purpose: Lifecycle management of trading bot Durable Objects (create, start, stop, status)
- Location: `src/worker/bots/base.ts`, `src/worker/bots/bot-do.ts`, `src/worker/bots/registry.ts`
- Contains: `BaseBotDO` abstract class, `BotDO` concrete class, strategy registry map
- Depends on: core/db (for heartbeat/audit writes), core/utils/logger
- Used by: API routes (`/api/bots/*/start`), Cloudflare alarm scheduler
- Purpose: Strategy-specific trading logic executed once per tick
- Location: `src/worker/bots/<strategy-name>/strategy.ts` (one file per strategy)
- Contains: Pure async tick functions (`StrategyTickFn = (bot: BaseBotDO, env: Env) => Promise<void>`)
- Depends on: core/exchanges (factory + client), core/risk (portfolio + kelly), core/db, core/market
- Used by: `BotDO.tick()` via registry lookup
- Purpose: Shared services used by all strategies and routes
- Location: `src/worker/core/`
- Contains:
- Depends on: D1 binding via `createDb(env.DB)`
- Used by: all strategies and API routes
- Purpose: React SPA for monitoring and control
- Location: `src/ui/`
- Contains: React pages, TanStack Query hooks, a typed `api` client, shadcn/ui components
- Depends on: Worker API at `/api/*` (proxied via Vite dev server to `localhost:8787`)
- Used by: end users; built to `dist/ui/` and served as static assets by the Worker
## Data Flow
- Server state: TanStack Query (no client-side state store)
- Bot runtime state: Durable Object storage (`ctx.storage.put/get`) for config and running flag
- Persistent state: Cloudflare D1 via Drizzle ORM
## Key Abstractions
- Purpose: Unified trading interface hiding platform differences between Polymarket and Kalshi
- Definition: `src/worker/core/exchanges/types.ts`
- Implementations: `src/worker/core/exchanges/polymarket/client.ts`, `src/worker/core/exchanges/kalshi/client.ts`
- Factory: `src/worker/core/exchanges/factory.ts` — `createExchangeClient(env, platform)`
- Pattern: Interface + factory, clients are constructed per-tick from env credentials
- Purpose: Base class providing alarm loop, trade recording, position upsert, config persistence, and audit logging
- Location: `src/worker/bots/base.ts`
- Pattern: Template Method — `tick()` is abstract, `alarm()` is the algorithm; subclass (`BotDO`) provides implementation
- Exposes RPC methods: `start()`, `stop()`, `getStatus()`, `updateConfig()`
- Purpose: Type for all trading strategies — `(bot: BaseBotDO, env: Env) => Promise<void>`
- Definition: `src/worker/bots/registry.ts`
- Pattern: Strategy pattern — functions registered by string key, looked up at runtime
- All 8 strategies in `src/worker/bots/*/strategy.ts` conform to this type
- Purpose: Enforces position limits, max total exposure, per-trade max loss, max open positions, daily loss circuit breaker
- Location: `src/worker/core/risk/portfolio.ts`
- Pattern: Service class instantiated per-tick with a DB handle and limit overrides via `getLimitsForBot()`
- Purpose: Single source of truth for all persistent state
- Location: `src/worker/core/db/schema.ts`
- Tables: `markets`, `market_links`, `prices`, `bot_instances`, `orders`, `trades`, `positions`, `bot_metrics`, `tracked_traders`, `audit_log`
- Pattern: All timestamps stored as ISO-8601 text; JSON config columns use `{ mode: 'json' }` with TypeScript generics
## Entry Points
- Location: `src/worker/index.ts`
- Triggers: Every HTTP request to the Worker
- Responsibilities: Mounts CORS, auth (bearer token), and Hono route modules; re-exports `BotDO` for Wrangler binding registration
- Location: `src/ui/main.tsx`
- Triggers: Browser load of `dist/ui/index.html`
- Responsibilities: Mounts React root, wraps app in `QueryClientProvider` and `BrowserRouter`
- Location: `src/worker/bots/bot-do.ts` (`BotDO` class), exported from `src/worker/index.ts`
- Triggers: DO instantiation via `env.BOT_DO.get(id)` RPC, or alarm firing
- Responsibilities: Hydrates config from DO storage on construction (`blockConcurrencyWhile`), delegates ticks to registered strategy
## Error Handling
- API routes use early-return `404` guards: `if (!bot) return c.json({ error: 'Not found' }, 404)`
- Exchange client errors during strategy init cause early return from tick (not a crash)
- Audit log failures are silently swallowed (`catch {}`) as non-critical
- Partial fill risk on multi-leg arb (cross-arb buy leg succeeds, sell leg fails) is logged as error but not rolled back — noted as a known concern
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
