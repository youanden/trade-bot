# Technology Stack

**Analysis Date:** 2026-03-21

## Languages

**Primary:**
- TypeScript 5.7 - All source code (worker and UI), strict mode enabled, ES2022 target

**Secondary:**
- None detected (pure TypeScript project)

## Runtime

**Environment:**
- Cloudflare Workers (via Wrangler 4.x) - primary server runtime
- Node.js compat layer enabled via `nodejs_compat` compatibility flag
- Browser (via Vite) - React UI

**Package Manager:**
- Bun (lockfile `bun.lock` present)
- Lockfile: present

## Frameworks

**Core:**
- Hono 4.7 - HTTP framework for Cloudflare Workers API server (`src/worker/index.ts`)
- React 19.0 - UI framework (`src/ui/`)
- React Router DOM 7.1 - Client-side routing (`src/ui/App.tsx`)

**Database ORM:**
- Drizzle ORM 0.38 - SQLite ORM for Cloudflare D1 (`src/worker/core/db/`)

**Testing:**
- Bun test runner (built-in) - test files in `test/`

**Build/Dev:**
- Vite 6.1 - UI dev server and bundler (`vite.config.ts`)
- Wrangler 4.0 - Cloudflare Workers dev server and deploy tool

## Key Dependencies

**Critical:**
- `viem` 2.47 - Ethereum/EVM library used for EIP-712 order signing and Polygon wallet interaction for Polymarket (`src/worker/core/exchanges/polymarket/client.ts`)
- `drizzle-orm` 0.38 - Database access layer for all persistence (`src/worker/core/db/`)
- `hono` 4.7 - API server framework, used for routing, CORS, bearer auth middleware (`src/worker/index.ts`)

**UI:**
- `@tanstack/react-query` 5.64 - Server state management and data fetching hooks (`src/ui/hooks/`)
- `recharts` 2.15 - Charting library used in Analytics page (`src/ui/pages/Analytics.tsx`)
- `lucide-react` 0.474 - Icon library
- `tailwindcss` 4.0 - CSS utility framework (`src/ui/globals.css`, via `@tailwindcss/vite` plugin)
- `class-variance-authority` 0.7 - Variant-based className composition (`src/ui/lib/utils.ts`)
- `clsx` + `tailwind-merge` - Class name utilities

**Infrastructure:**
- `@cloudflare/workers-types` 4.x - TypeScript types for Cloudflare bindings (D1, Durable Objects, AI)

## Configuration

**Environment:**
- All secrets injected via Cloudflare Workers env bindings (defined in `env.d.ts`)
- Required secrets: `POLYMARKET_API_KEY`, `POLYMARKET_PRIVATE_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PASSPHRASE`, `POLYMARKET_ADDRESS`, `KALSHI_API_KEY`, `KALSHI_API_SECRET`
- Optional: `AUTH_TOKEN` (skips bearer auth if absent — dev mode)
- `ENVIRONMENT` var defaults to `"development"`

**TypeScript:**
- Path aliases: `@worker/*` → `./src/worker/*`, `@ui/*` → `./src/ui/*`
- Config: `tsconfig.json`

**Build:**
- `vite.config.ts` - UI build, outputs to `dist/ui/`, proxies `/api` to `localhost:8787` in dev
- `wrangler.toml` - Worker entry point `src/worker/index.ts`, assets served from `./dist/ui`
- `drizzle.config.ts` - Schema at `src/worker/core/db/schema.ts`, dialect SQLite, migrations in `drizzle/`

## Platform Requirements

**Development:**
- Bun runtime
- Wrangler CLI for Worker dev server (`wrangler dev` on port 8787)
- Vite dev server (`vite dev`) with API proxy to Worker

**Production:**
- Cloudflare Workers platform
- Cloudflare D1 (SQLite-compatible managed database) — database name `trade-bot-db`
- Cloudflare Durable Objects — `BotDO` class for stateful bot execution
- Cloudflare AI binding — `env.AI` used by LLM-based strategies
- Static assets served from Cloudflare CDN (`dist/ui/`)

---

*Stack analysis: 2026-03-21*
