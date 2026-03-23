---
phase: quick
plan: 260322-uyr
type: execute
wave: 1
depends_on: []
files_modified:
  - src/worker/core/exchanges/kalshi/leaderboard.ts
  - src/worker/bots/copy-trader/config.ts
  - src/worker/bots/copy-trader/strategy.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "Copy-trader bot with platform='kalshi' and leaderboardMode=true fetches top Kalshi markets by volume as crowd-wisdom signals"
    - "Kalshi leaderboard returns market tickers ranked by volume, which strategy uses as 'traderIds' (market tickers to trade on)"
    - "Existing Polymarket leaderboard behavior is completely unchanged"
  artifacts:
    - path: "src/worker/core/exchanges/kalshi/leaderboard.ts"
      provides: "fetchKalshiLeaderboard function returning top markets by volume"
      exports: ["fetchKalshiLeaderboard", "KalshiLeaderboardEntry", "KalshiLeaderboardParams"]
    - path: "src/worker/bots/copy-trader/config.ts"
      provides: "Kalshi-specific leaderboard config fields"
      contains: "kalshiMinVolume"
    - path: "src/worker/bots/copy-trader/strategy.ts"
      provides: "Platform-aware leaderboard refresh and Kalshi position fetching"
      contains: "fetchKalshiLeaderboard"
  key_links:
    - from: "src/worker/bots/copy-trader/strategy.ts"
      to: "src/worker/core/exchanges/kalshi/leaderboard.ts"
      via: "import fetchKalshiLeaderboard"
      pattern: "fetchKalshiLeaderboard"
    - from: "src/worker/bots/copy-trader/strategy.ts"
      to: "src/worker/core/exchanges/kalshi/client.ts"
      via: "KalshiClient.getMarkets for crowd-wisdom market discovery"
      pattern: "getMarkets"
---

<objective>
Implement Kalshi leaderboard copy trading using a crowd-wisdom approach.

Purpose: Kalshi has no public leaderboard API like Polymarket. Instead, this implements a "crowd wisdom" strategy: fetch the top Kalshi markets by volume/open interest, and use those as trading signals. When leaderboardMode is enabled for a Kalshi copy-trader bot, the strategy discovers high-volume markets and places trades on the dominant side (YES or NO based on price skew), effectively copying the crowd's conviction.

Output: Working Kalshi leaderboard module, updated copy-trader strategy with platform-aware leaderboard refresh, and Kalshi-specific config fields.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/worker/core/exchanges/kalshi/client.ts
@src/worker/core/exchanges/kalshi/types.ts
@src/worker/core/exchanges/polymarket/leaderboard.ts
@src/worker/bots/copy-trader/strategy.ts
@src/worker/bots/copy-trader/config.ts
@src/worker/core/exchanges/types.ts

<interfaces>
<!-- KalshiClient.getMarkets is the key public API we'll use -->
From src/worker/core/exchanges/kalshi/client.ts:
```typescript
async getMarkets(params?: {
  limit?: number;
  cursor?: string;
  status?: string;
}): Promise<{ markets: MarketInfo[]; nextCursor?: string }>
```

From src/worker/core/exchanges/kalshi/types.ts:
```typescript
export const KALSHI_URLS = {
  prod: { rest: "https://api.elections.kalshi.com/trade-api/v2" },
  demo: { rest: "https://demo-api.kalshi.co/trade-api/v2" },
} as const;

export interface KalshiMarket {
  ticker: string;
  title: string;
  status: "active" | "closed" | "settled";
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  yes_bid_dollars?: string;
  no_bid_dollars?: string;
  last_price_dollars?: string;
  category?: string;
  event_ticker: string;
}
```

From src/worker/core/exchanges/polymarket/leaderboard.ts:
```typescript
export interface LeaderboardEntry {
  rank: number;
  proxyWallet: string;
  userName: string;
  pnl: number;
  vol: number;
}
export async function fetchLeaderboard(params: LeaderboardParams): Promise<LeaderboardEntry[]>
```

From src/worker/bots/copy-trader/config.ts:
```typescript
export interface CopyTraderConfig extends BotConfig {
  platform: "polymarket" | "kalshi";
  traderIds: string[];
  leaderboardMode?: boolean;
  leaderboardRefreshMs?: number;
  leaderboardTopN?: number;
  leaderboardTimePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  _lastLeaderboardRefresh?: string;
}
```

From src/worker/bots/copy-trader/strategy.ts:
```typescript
// fetchTraderPositions currently returns [] for Kalshi (line 460)
// maybeRefreshLeaderboard only calls Polymarket fetchLeaderboard (line 106)
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create Kalshi leaderboard module and update config</name>
  <files>src/worker/core/exchanges/kalshi/leaderboard.ts, src/worker/bots/copy-trader/config.ts</files>
  <action>
Create `src/worker/core/exchanges/kalshi/leaderboard.ts` mirroring the pattern from `src/worker/core/exchanges/polymarket/leaderboard.ts`:

1. Define `KalshiLeaderboardEntry` interface:
   - `rank: number`
   - `ticker: string` (market ticker, analogous to Polymarket's proxyWallet)
   - `title: string`
   - `volume: number`
   - `volume24h: number`
   - `openInterest: number`
   - `dominantSide: "yes" | "no"` (derived from price — if last_price > 0.50, YES is dominant)
   - `dominantPrice: number` (the price on the dominant side)

2. Define `KalshiLeaderboardParams` interface:
   - `limit?: number` (default 10)
   - `minVolume?: number` (filter out low-volume markets)
   - `category?: string` (optional category filter)
   - `status?: string` (default "open" — only active markets)

3. Export `fetchKalshiLeaderboard(params: KalshiLeaderboardParams): Promise<KalshiLeaderboardEntry[]>`:
   - Use Kalshi's public markets endpoint: `GET {KALSHI_URLS.prod.rest}/markets`
   - Pass query params: `limit` (use params.limit ?? 50 to fetch more than needed for filtering), `status` (params.status ?? "open")
   - If `params.category`, add `category` query param
   - Parse response `data.markets` as `KalshiMarket[]`
   - Filter: only markets with `volume > (params.minVolume ?? 0)` and status === "active"
   - Sort by `volume` descending (highest volume first)
   - Slice to `params.limit ?? 10`
   - Map each market to `KalshiLeaderboardEntry`:
     - `rank`: index + 1
     - `ticker`: m.ticker
     - `title`: m.title
     - `volume`: m.volume ?? 0
     - `volume24h`: m.volume_24h ?? 0
     - `openInterest`: m.open_interest ?? 0
     - `dominantSide`: if last_price_dollars > 0.50 then "yes", else "no"
     - `dominantPrice`: Number(m.last_price_dollars ?? "0.50")
   - This is a PUBLIC endpoint (no auth needed for market listing) — use native `fetch` directly, same as Polymarket leaderboard pattern
   - Import `KALSHI_URLS` from `./types`

4. Update `src/worker/bots/copy-trader/config.ts`:
   - Add optional fields to `CopyTraderConfig`:
     - `kalshiMinVolume?: number` — minimum volume threshold for crowd-wisdom markets (default: 1000)
     - `kalshiCategory?: string` — optional Kalshi category filter (e.g., "politics", "economics")
   - These are all optional to maintain backward compatibility
  </action>
  <verify>
    <automated>cd /Users/youanden/Work/trade-bot && npx tsc --noEmit --pretty 2>&1 | head -30</automated>
  </verify>
  <done>
    - `src/worker/core/exchanges/kalshi/leaderboard.ts` exists with exported `fetchKalshiLeaderboard`, `KalshiLeaderboardEntry`, `KalshiLeaderboardParams`
    - `CopyTraderConfig` has `kalshiMinVolume` and `kalshiCategory` optional fields
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire Kalshi leaderboard into copy-trader strategy</name>
  <files>src/worker/bots/copy-trader/strategy.ts</files>
  <action>
Update `src/worker/bots/copy-trader/strategy.ts` to support Kalshi leaderboard mode:

1. Add import at top:
   ```typescript
   import { fetchKalshiLeaderboard } from "../../core/exchanges/kalshi/leaderboard";
   ```

2. Modify `maybeRefreshLeaderboard` to be platform-aware:
   - Keep existing Polymarket logic intact (when `config.platform === "polymarket"`)
   - Add Kalshi branch (when `config.platform === "kalshi"`):
     - Call `fetchKalshiLeaderboard({ limit: config.leaderboardTopN ?? 10, minVolume: config.kalshiMinVolume ?? 1000, category: config.kalshiCategory })`
     - For each entry, upsert into `trackedTraders` table with `platform: "kalshi"` and `traderId: entry.ticker` (the market ticker serves as the "trader" identity in crowd-wisdom mode)
     - Set `alias: entry.title`, `totalPnl: entry.volume` (volume as proxy metric), `isActive: true`
     - Update `config.traderIds` to the list of tickers: `entries.map(e => e.ticker)`
     - Update `config._lastLeaderboardRefresh` and persist via `bot.updateConfig`
     - Log: `leaderboard:kalshi:refreshed` with `{ marketCount: entries.length }`

3. Modify `fetchTraderPositions` for Kalshi:
   - Currently returns `[]` for Kalshi — replace with crowd-wisdom position generation
   - When `platform === "kalshi"`: the `traderId` IS a market ticker (from leaderboard)
   - Fetch market data: `fetch(KALSHI_URLS.prod.rest + "/markets/" + traderId)` (public endpoint)
   - Parse the market response to determine crowd conviction:
     - If `last_price_dollars` exists, use it to determine dominant side
     - If price > 0.50: return `[{ marketId: traderId, outcome: "yes", size: 1 }]` (synthetic position indicating crowd favors YES)
     - If price <= 0.50: return `[{ marketId: traderId, outcome: "no", size: 1 }]`
     - Size of 1 is a signal — actual trade sizing is handled by `sizeFraction` and `maxPositionSize` in `processTrader`
   - Wrap in try/catch, return `[]` on failure (same pattern as Polymarket)
   - Import `KALSHI_URLS` from `../../core/exchanges/kalshi/types`

4. Important: The existing `processTrader` flow already handles the rest:
   - It calls `fetchTraderPositions` to get positions
   - Compares against `lastSeenPositions` cache to detect changes
   - Places orders via `client.placeOrder`
   - Records trades and sends Discord notifications
   - No changes needed in `processTrader` itself
  </action>
  <verify>
    <automated>cd /Users/youanden/Work/trade-bot && npx tsc --noEmit --pretty 2>&1 | head -30</automated>
  </verify>
  <done>
    - `maybeRefreshLeaderboard` handles both Polymarket and Kalshi platforms
    - `fetchTraderPositions` returns crowd-wisdom positions for Kalshi markets (not empty array)
    - Kalshi leaderboard mode discovers high-volume markets and generates synthetic positions based on price skew
    - Existing Polymarket behavior is completely unchanged
    - TypeScript compiles without errors
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes — all types align
2. Existing Polymarket leaderboard path is unchanged (no regressions)
3. New Kalshi leaderboard module follows same patterns as Polymarket leaderboard (native fetch, no npm deps, exported types)
4. CopyTraderConfig additions are all optional (backward compatible)
</verification>

<success_criteria>
- A Kalshi copy-trader bot with `leaderboardMode: true` will discover top markets by volume and generate trades on the dominant side
- The crowd-wisdom approach (volume-ranked markets + price-skew signals) is a viable alternative to Polymarket's actual trader-following
- All new config fields are optional — existing bots are unaffected
- No new npm dependencies added
</success_criteria>

<output>
After completion, create `.planning/quick/260322-uyr-implement-kalshi-leaderboard-copy-tradin/260322-uyr-SUMMARY.md`
</output>
