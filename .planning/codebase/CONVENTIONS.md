# Coding Conventions

**Analysis Date:** 2026-03-21

## Naming Patterns

**Files:**
- Worker source files: `camelCase.ts` for utilities/clients (e.g., `client.ts`, `schema.ts`, `kelly.ts`)
- Strategy files: `strategy.ts` and `config.ts` per bot subdirectory
- React components: `PascalCase.tsx` (e.g., `Dashboard.tsx`, `BotDetail.tsx`)
- React hooks: `camelCase.ts` prefixed with `use` (e.g., `useBots.ts`, `useMarkets.ts`)
- Test files: `camelCase.test.ts` (e.g., `kelly.test.ts`, `analytics.test.ts`)

**Functions (Worker):**
- Exported pure functions: `camelCase` (e.g., `kellyFraction`, `calculateSharpe`, `createExchangeClient`)
- Strategy tick functions: `{botType}Tick` pattern (e.g., `crossArbTick`, `marketMakerTick`, `copyTraderTick`)
- Internal/private helpers: `camelCase` (e.g., `titleSimilarity`, `tokenize`, `makeMarket`)

**Variables:**
- Locals and parameters: `camelCase`
- Constants/config: `UPPER_SNAKE_CASE` for true module-level constants (e.g., `DEFAULT_LIMITS`, `LEVEL_PRIORITY`, `KALSHI_URLS`)
- DB query intermediates: descriptive camelCase (e.g., `openPositions`, `botTrades`, `linkedIds`)

**Types and Interfaces:**
- Interfaces: `PascalCase` prefixed descriptively (e.g., `BotConfig`, `TradeRecord`, `RiskCheck`, `KellyParams`)
- Type aliases: `PascalCase` (e.g., `LogLevel`, `StrategyTickFn`, `Database`)
- Enum-like string unions: inline literals, not enums (e.g., `"polymarket" | "kalshi"`, `"buy" | "sell"`)
- Drizzle inferred types: `typeof table.$inferSelect` pattern (e.g., `typeof markets.$inferSelect`)

**Classes:**
- `PascalCase` with descriptive suffix (e.g., `KalshiClient`, `PortfolioRisk`, `MarketMatcher`, `Logger`, `BaseBotDO`)
- Abstract base classes suffixed with `DO` for Durable Objects (e.g., `BaseBotDO`)

## Code Style

**Formatting:**
- No formatter config file detected (no `.prettierrc`, `biome.json`, or `eslint.config.*`)
- Observed style: 2-space indentation, double quotes for strings, trailing commas in multi-line structures
- Line length: approximately 80-100 characters before wrapping
- Template literals used for string interpolation (e.g., `` `$${cost.toFixed(2)}` ``)

**Linting:**
- No ESLint config detected
- TypeScript strict mode enforced via `tsconfig.json` (`"strict": true`)
- `isolatedModules: true` set, requiring explicit type imports (`import type { ... }`)

**TypeScript Strictness:**
- All `import type` syntax used where only types are needed (e.g., `import type { ExchangeClient } from "../types"`)
- Error values narrowed via `err instanceof Error ? err.message : String(err)` pattern
- Optional chaining used extensively (e.g., `bot.config?.dbBotId`, `orderBook.bids[0]?.price ?? 0`)
- Nullish coalescing used for defaults (e.g., `?? 0`, `?? []`, `?? "unknown"`)

## Import Organization

**Order (observed):**
1. External packages (e.g., `import { Hono } from "hono"`, `import { DurableObject } from "cloudflare:workers"`)
2. Internal absolute imports using path aliases (`@worker/*`, `@ui/*`) — aliases defined but sparingly used; most imports use relative paths
3. Relative imports, deeper-to-shallower (e.g., `../../core/db/client`, `../types`, `./config`)

**Path Aliases (defined in `tsconfig.json`):**
- `@worker/*` → `./src/worker/*`
- `@ui/*` → `./src/ui/*`
- Note: aliases are defined but actual usage relies on relative paths in practice

**Type-only imports:**
- Always use `import type { ... }` for type-only imports (enforced by `isolatedModules`)

## Error Handling

**Worker code pattern:**
```typescript
try {
  await someOperation();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.error("operation:failed", { error: msg });
  // Either return early or re-throw depending on criticality
}
```

**Non-critical operations** (e.g., audit logging, order cancellation): swallow with empty `catch {}` block and comment explaining rationale
```typescript
try {
  await client.cancelOrder(orderId);
} catch {
  // Order may already be filled or cancelled
}
```

**API route pattern** (Hono): return JSON error responses with appropriate status codes
```typescript
if (!bot) return c.json({ error: "Not found" }, 404);
if (!bot.durableObjectId) return c.json({ error: "No DO ID assigned" }, 400);
```

**UI pattern**: React Query handles async errors; no custom try/catch in components

## Logging

**Framework:** Custom `Logger` class at `src/worker/core/utils/logger.ts`

**Usage:**
- Module-level logger instantiation with context object:
  ```typescript
  const log = new Logger({ strategy: "cross-arb" });
  // or
  const log = new Logger({ module: "market-matcher" });
  ```
- Child loggers for additional context:
  ```typescript
  this.log = new Logger({ do: "BotDO", id: ctx.id.toString() });
  ```

**Log message format:** `"component:event"` colon-separated namespace pattern
```typescript
log.info("tick:start", { tickCount: this.tickCount });
log.error("tick:client-init-failed", { error: msg });
log.warn("circuit-breaker:daily-loss", { loss: todayLoss, limit: this.limits.maxDailyLoss });
```

**Output:** JSON to `console.log`/`console.warn`/`console.error` — structured for Cloudflare Workers logging

**Log levels:** `debug`, `info`, `warn`, `error` — use `debug` for per-tick diagnostic data, `info` for state transitions, `warn` for soft failures, `error` for caught exceptions

## Comments

**When to Comment:**
- JSDoc blocks on exported functions with non-obvious parameters using `@param` tags
- Single-line `//` comments for algorithm steps numbered inline (e.g., `// 1. Get order book and calculate midpoint`)
- Inline comments on schema fields explaining allowed values (e.g., `// 'polymarket' | 'kalshi'`)
- Class-level JSDoc explaining high-level purpose

**JSDoc style:**
```typescript
/**
 * Kelly criterion position sizing.
 *
 * Full Kelly: f* = (p * b - q) / b
 *   where p = win probability, q = 1-p, b = net odds (payout / stake)
 *
 * @param params.probability - Our estimated probability of YES
 * @param params.odds - Market price for YES (0-1)
 */
export function kellySize(params: KellyParams): RiskCheck {
```

**Section dividers:** `// ── Section Name ──` ASCII-art style used to segment large files into logical sections (seen in `base.ts`, `client.ts`, `schema.ts`)

## Function Design

**Size:** Pure computation functions are small and focused (10-25 lines). Strategy tick functions can be longer (50-200 lines) but are decomposed into private helpers.

**Parameters:**
- Single object params for functions with 3+ args (e.g., `kellySize(params: KellyParams)`)
- Individual positional params for 1-2 args (e.g., `kellyFraction(probability, marketPrice)`)
- Optional params use `?` suffix in interface, not overloading

**Return Values:**
- Async functions return `Promise<T>` with explicit T
- No implicit `any` returns; return types annotated on public functions
- Result objects used for multi-value returns (e.g., `RiskCheck` with `allowed`, `reason`, `suggestedSize`)

## Module Design

**Exports:**
- Named exports only — no default exports observed anywhere in the codebase
- Each module exports related functions/classes; no barrel index files

**Barrel Files:** Not used — imports reference specific files directly (e.g., `from "../../core/risk/kelly"` not `from "../../core/risk"`)

**Worker vs UI separation:**
- Worker code under `src/worker/` — never imports from `src/ui/`
- UI code under `src/ui/` — communicates with worker only via HTTP API (`src/ui/lib/api.ts`)
- Shared types: none — types are duplicated between layers as needed

## React Conventions

**Components:**
- Named function exports (not arrow function exports) for page-level components: `export function Dashboard()`
- Sub-components co-located in the same file if small and page-specific (e.g., `StatusCard`, `BotCard` inside `Dashboard.tsx`)
- Props typed inline with destructuring: `function BotCard({ bot, onStart, ... }: { bot: any; onStart: () => void; ... })`

**Hooks:**
- One hook per file in `src/ui/hooks/`
- Thin wrappers around React Query (`useQuery`/`useMutation`) — no local state in data hooks
- Cache invalidation on mutations via `qc.invalidateQueries`
- Polling via `refetchInterval` option (e.g., 5000ms for bot status)

**Styling:**
- Tailwind CSS utility classes only — no CSS modules, no inline `style` props
- `cn()` utility from `src/ui/lib/utils.ts` for conditional class merging (`clsx` + `tailwind-merge`)
- Tailwind v4 with `@tailwindcss/vite` plugin — no `tailwind.config.js`

---

*Convention analysis: 2026-03-21*
