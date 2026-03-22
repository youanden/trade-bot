# Phase 9: Discord Trade Notifications & Leaderboard Copy Strategy - Research

**Researched:** 2026-03-22
**Domain:** Discord Webhook API, Polymarket Data API (leaderboard), Cloudflare Workers native fetch
**Confidence:** HIGH

## Summary

This phase adds two features to the copy-trader strategy: Discord webhook notifications on trade execution, and dynamic leaderboard-based trader discovery. Both are straightforward HTTP integrations: Discord webhooks are fire-and-forget POSTs using native `fetch`, and the Polymarket leaderboard endpoint (`data-api.polymarket.com/v1/leaderboard`) is an unauthenticated public API already in the same family as the trader positions API the strategy already calls.

The notification service should be a standalone pure utility function (`src/worker/core/notifications/discord.ts`) receiving a typed trade event and the webhook URL, with no coupling to Drizzle or bot infrastructure. The leaderboard client belongs in `src/worker/core/exchanges/polymarket/leaderboard.ts` alongside the existing Polymarket client, and returns records shaped for direct insertion into the `tracked_traders` table.

The main integration risks are: Discord's 5-requests-per-2-seconds rate limit (easily hit if a tick produces many trades), and the leaderboard refresh call adding latency to every nth tick in leaderboard mode. Both have straightforward mitigations documented below.

**Primary recommendation:** Implement notification as a fire-and-forget utility with silent failure; implement leaderboard refresh as a configurable interval check guarded by a last-refresh timestamp stored in bot config or DO storage.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Discord trade notifications use webhooks via native fetch POST from Workers — no persistent connections, no WebSocket, no bot process
- **D-02:** No Discord library needed — DISC-01 through DISC-04 use only native fetch; no npm packages for Discord interaction
- **D-03:** Interactive Discord bot features (if needed later) would use discordeno — deferred, out of phase 09 scope

### Claude's Discretion
- Exact emoji set for trade type indicators
- Whether to use Discord embeds vs plain text content for message formatting
- Retry logic for webhook delivery failures
- Message batching strategy if multiple trades execute in same tick
- Rate limiting approach for Discord webhook API (30 requests/minute per channel)

### Deferred Ideas (OUT OF SCOPE)
- Interactive Discord bot with slash commands for leaderboard queries and copy strategy management
- Discord bot presence/status display
- Channel management or role-based notifications
- Rich thread-based trade discussion per market
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | Discord webhook notification service that formats trade events (COPY BUY/SELL, TAKE PROFIT, STOP LOSS) into emoji-rich messages and POSTs via fetch | Discord embed API verified; payload schema documented in Code Examples section |
| DISC-02 | Webhook URL stored as Cloudflare Workers secret binding (DISCORD_WEBHOOK_URL) | env.d.ts extension pattern documented; wrangler.toml vars vs secrets pattern established |
| DISC-03 | Message format includes trade type, market name, outcome, price, shares, cost, fees, P&L on sells, trader address (abbreviated), timestamp, portfolio summary footer | Full embed field map in Code Examples; portfolio summary derives from existing DB queries |
| DISC-04 | Notification service integrated into copy trader strategy trade execution flow | Integration point identified in processTrader() after recordTrade(); env threading pattern documented |
| LEAD-01 | Polymarket leaderboard API client to fetch top trader rankings and performance metrics | API verified live — GET https://data-api.polymarket.com/v1/leaderboard, response shape confirmed by direct probe |
| LEAD-02 | Copy trader strategy uses leaderboard data to dynamically update tracked_traders list | DB upsert pattern into tracked_traders table documented; config extension pattern shown |
| LEAD-03 | Leaderboard refresh interval configurable in bot config | Config interface extension with leaderboardRefreshMs field; last-refresh guard pattern documented |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | Runtime built-in | HTTP POST to Discord webhook | Locked decision D-01; works natively in Cloudflare Workers |
| Drizzle ORM | 0.38 (existing) | Upsert leaderboard traders to tracked_traders | Already in project; schema table exists |
| `drizzle-orm/bun-sqlite` | 0.38 (existing) | Test-time DB for unit tests | Established project test pattern |

### No New Dependencies
This phase requires zero new npm packages. All functionality uses:
- Native `fetch` (Cloudflare Workers global)
- Existing Drizzle ORM
- Existing schema tables (`tracked_traders`)
- Existing logger pattern (`Logger` class)

**Installation:** None required.

## Architecture Patterns

### Recommended File Structure
```
src/worker/
├── core/
│   └── notifications/
│       └── discord.ts           # DISC-01, DISC-02, DISC-03: notification utility
├── core/exchanges/polymarket/
│   └── leaderboard.ts           # LEAD-01: leaderboard API client
└── bots/copy-trader/
    ├── config.ts                # LEAD-03: extend CopyTraderConfig with leaderboard fields
    └── strategy.ts              # DISC-04, LEAD-02: integrate both into tick flow

env.d.ts                         # DISC-02: add DISCORD_WEBHOOK_URL?: string
```

### Pattern 1: Discord Notification Utility (DISC-01, DISC-02, DISC-03)

**What:** A pure async function accepting a `TradeNotification` event and the webhook URL. Builds a Discord embed payload and POSTs it. No imports from Drizzle, bot, or exchange layers.

**When to use:** Called by copy-trader strategy immediately after `recordTrade()` completes, if `env.DISCORD_WEBHOOK_URL` is set.

**Example:**
```typescript
// src/worker/core/notifications/discord.ts

export type TradeType = "COPY_BUY" | "COPY_SELL" | "TAKE_PROFIT" | "STOP_LOSS";

const TRADE_EMOJI: Record<TradeType, string> = {
  COPY_BUY:    "📈",
  COPY_SELL:   "📉",
  TAKE_PROFIT: "✅",
  STOP_LOSS:   "🛑",
};

const TRADE_COLOR: Record<TradeType, number> = {
  COPY_BUY:    3066993,  // green
  COPY_SELL:   10038562, // orange
  TAKE_PROFIT: 3066993,  // green
  STOP_LOSS:   15158332, // red
};

export interface TradeNotification {
  tradeType: TradeType;
  marketName: string;
  outcome: "yes" | "no";
  price: number;
  shares: number;
  cost: number;
  fee: number;
  pnl?: number;           // sells only
  traderAddress?: string; // copy trades only
  category?: string;
  timestamp: string;      // ISO-8601
  portfolioSummary: {
    cash: number;
    equity: number;
    realizedPnl: number;
    totalFees: number;
    netPnl: number;
    openPositions: number;
    totalTrades: number;
  };
}

/**
 * Post a trade notification to a Discord webhook.
 * Fire-and-forget — errors are logged but never thrown.
 * @param webhookUrl - Full Discord webhook URL from env.DISCORD_WEBHOOK_URL
 * @param notification - Trade event data
 */
export async function notifyDiscord(
  webhookUrl: string,
  notification: TradeNotification
): Promise<void> {
  const { tradeType, marketName, outcome, price, shares, cost, fee,
          pnl, traderAddress, category, timestamp, portfolioSummary } = notification;

  const emoji = TRADE_EMOJI[tradeType];
  const color = TRADE_COLOR[tradeType];

  const fields = [
    { name: "Market", value: marketName.slice(0, 256), inline: false },
    { name: "Outcome", value: outcome.toUpperCase(), inline: true },
    { name: "Price", value: `$${price.toFixed(3)}`, inline: true },
    { name: "Shares", value: shares.toFixed(2), inline: true },
    { name: "Cost", value: `$${cost.toFixed(2)}`, inline: true },
    { name: "Fee", value: `$${fee.toFixed(2)}`, inline: true },
  ];

  if (pnl !== undefined) {
    fields.push({ name: "P&L", value: `$${pnl.toFixed(2)}`, inline: true });
  }
  if (traderAddress) {
    const abbrev = `${traderAddress.slice(0, 6)}...${traderAddress.slice(-4)}`;
    fields.push({ name: "Copied Trader", value: abbrev, inline: true });
  }
  if (category) {
    fields.push({ name: "Category", value: `[${category}]`, inline: true });
  }

  const { cash, equity, realizedPnl, totalFees, netPnl,
          openPositions, totalTrades } = portfolioSummary;
  const footerText =
    `Cash: $${cash.toFixed(2)} | Equity: $${equity.toFixed(2)} | ` +
    `Realized P&L: $${realizedPnl.toFixed(2)} | Fees: $${totalFees.toFixed(2)} | ` +
    `Net: $${netPnl.toFixed(2)} | Positions: ${openPositions} | Trades: ${totalTrades}`;

  const payload = {
    embeds: [
      {
        title: `${emoji} ${tradeType.replace("_", " ")}`,
        color,
        fields,
        footer: { text: footerText.slice(0, 2048) },
        timestamp,
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Log but do not throw — notification failure must not break trade execution
      console.warn(`discord-webhook:${res.status}`);
    }
  } catch {
    // Network errors silently swallowed — trade execution is unaffected
  }
}
```

### Pattern 2: Polymarket Leaderboard Client (LEAD-01)

**What:** A standalone async function in `src/worker/core/exchanges/polymarket/leaderboard.ts` that fetches top traders and maps them to `TrackedTrader`-compatible records.

**When to use:** Called by copy-trader strategy tick when `leaderboardMode: true` and sufficient time has elapsed since last refresh.

```typescript
// src/worker/core/exchanges/polymarket/leaderboard.ts
// Source: https://data-api.polymarket.com/v1/leaderboard (verified live 2026-03-22)

export interface LeaderboardEntry {
  rank: number;
  proxyWallet: string;
  userName: string;
  pnl: number;
  vol: number;
}

export interface LeaderboardParams {
  timePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  orderBy?: "PNL" | "VOL";
  limit?: number;         // 1-50; default 25
  offset?: number;
  category?: string;      // OVERALL | POLITICS | SPORTS | CRYPTO | etc.
}

/**
 * Fetch top traders from Polymarket leaderboard API.
 * Public endpoint — no auth required.
 */
export async function fetchLeaderboard(
  params: LeaderboardParams = {}
): Promise<LeaderboardEntry[]> {
  const qs = new URLSearchParams();
  if (params.timePeriod) qs.set("timePeriod", params.timePeriod);
  if (params.orderBy)    qs.set("orderBy", params.orderBy);
  if (params.limit)      qs.set("limit", String(params.limit));
  if (params.offset)     qs.set("offset", String(params.offset));
  if (params.category)   qs.set("category", params.category);

  const url = `https://data-api.polymarket.com/v1/leaderboard?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Leaderboard API ${res.status}: ${await res.text()}`);
  }

  const data: Array<{
    rank: string;
    proxyWallet: string;
    userName: string;
    pnl: number;
    vol: number;
  }> = await res.json();

  return data.map((e) => ({
    rank: Number(e.rank),
    proxyWallet: e.proxyWallet,
    userName: e.userName ?? e.proxyWallet,
    pnl: e.pnl ?? 0,
    vol: e.vol ?? 0,
  }));
}
```

### Pattern 3: CopyTraderConfig Extension (LEAD-02, LEAD-03)

**What:** Extend `CopyTraderConfig` with leaderboard mode fields. The strategy checks `config.leaderboardMode` and when true, uses leaderboard data to repopulate `traderIds` at the configured interval.

```typescript
// Extension to CopyTraderConfig in src/worker/bots/copy-trader/config.ts

export interface CopyTraderConfig extends BotConfig {
  // ... existing fields ...

  /** When true, populates traderIds from Polymarket leaderboard each refresh interval */
  leaderboardMode?: boolean;
  /** How often to refresh leaderboard (ms). Default: 3_600_000 (1 hour) */
  leaderboardRefreshMs?: number;
  /** How many top traders to copy from leaderboard. Default: 10 */
  leaderboardTopN?: number;
  /** Leaderboard time window to rank by */
  leaderboardTimePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  /** ISO-8601 timestamp of last leaderboard refresh (internal, stored in DO) */
  _lastLeaderboardRefresh?: string;
}
```

### Pattern 4: env.d.ts Extension (DISC-02)

**What:** Add `DISCORD_WEBHOOK_URL` as optional binding to the `Env` interface. The notification service checks for its presence before attempting delivery.

```typescript
// env.d.ts — add to existing Env interface
interface Env {
  // ... existing bindings ...
  DISCORD_WEBHOOK_URL?: string;
}
```

**wrangler.toml note:** Secrets are set via `wrangler secret put DISCORD_WEBHOOK_URL`, not via `[vars]`. No wrangler.toml change needed for secrets.

### Pattern 5: Strategy Integration Point (DISC-04, LEAD-02)

**What:** The `copyTraderTick` entry point gains two responsibilities:
1. Before the trader loop: check if leaderboard refresh is due; if so, fetch and upsert to `tracked_traders`
2. Inside `processTrader`, after each successful `recordTrade`: call `notifyDiscord` if `env.DISCORD_WEBHOOK_URL` is set

**Integration sketch:**
```typescript
// Inside copyTraderTick, at the top of the function body:
if (config.leaderboardMode) {
  await maybeRefreshLeaderboard(bot, env, config, db);
}

// Inside processTrader, after bot.recordTrade() succeeds:
if (env.DISCORD_WEBHOOK_URL) {
  const summary = await buildPortfolioSummary(db, config.dbBotId);
  await notifyDiscord(env.DISCORD_WEBHOOK_URL, {
    tradeType: "COPY_BUY",
    marketName: marketInfo?.title ?? pos.marketId,
    // ...
    portfolioSummary: summary,
  });
}
```

### Pattern 6: Portfolio Summary for Notification Footer

**What:** Query the DB for positions and trades to build the `portfolioSummary` footer. This mirrors what `computeBotMetrics` in `analytics.ts` does but returns a simpler shape.

```typescript
// Derive summary from existing schema tables (positions, trades, botMetrics)
async function buildPortfolioSummary(
  db: ReturnType<typeof createDb>,
  botInstanceId?: number
): Promise<TradeNotification["portfolioSummary"]> {
  // openPositions: count of positions WHERE status='open' AND botInstanceId=id
  // totalTrades: count of trades WHERE botInstanceId=id
  // realizedPnl: sum of trades.pnl WHERE botInstanceId=id
  // totalFees: sum of trades.fee WHERE botInstanceId=id
  // equity: sum of (positions.size * positions.currentPrice) for open positions
  // cash: not stored directly — approximation or omit if unavailable
}
```

**Note:** The schema does not have a `cash` balance column. Cash balance in simulation comes from `SimExchangeClient.getBalance()`. In production, balance must be fetched from the exchange client. For the notification footer, either (a) pass cash as a parameter from the caller (where the exchange client result is available), or (b) display `N/A` for cash. Recommendation: thread `cashBalance` as a parameter to `buildPortfolioSummary`.

### Anti-Patterns to Avoid

- **Throwing on notification failure:** Discord delivery must be fire-and-forget. Any throw from `notifyDiscord` would abort the trade recording flow. Always use try/catch and silently log.
- **Calling leaderboard API every tick:** This is a remote HTTP call. Gate it behind a last-refresh interval check. Leaderboard data changes slowly; 1-hour refresh is appropriate.
- **Storing leaderboard results only in memory:** The in-memory `Map` in strategy.ts is DO-scoped but loses state on DO eviction. Persist leaderboard-sourced traders to `tracked_traders` table so the DO re-hydrates from DB on restart.
- **Hardcoding trader addresses from leaderboard:** Leaderboard returns `proxyWallet` addresses, same format as the positions API already expects. Pass directly as `traderId`.
- **Using embed field `value` > 1024 chars:** Discord enforces this silently truncating or rejecting. Always `.slice(0, 1024)` embed field values.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP POST to Discord | Custom fetch wrapper with retries | Simple `fetch` POST, silent failure | Retry logic for notifications adds complexity with no trading benefit; rate limit handling over-engineered for 1-trade-per-tick cadence |
| Discord message formatting library | Custom embed builder | Direct JSON object literal | Webhook payload is trivially simple; library overhead unjustified (locked per D-02) |
| Leaderboard polling scheduler | Custom interval timer | Last-refresh timestamp check at tick start | DO alarm loop already provides the scheduling primitive; no separate scheduler needed |
| Leaderboard data normalization | Custom field mapping layer | Direct `.map()` in leaderboard.ts | Response shape is stable and simple; full ORM mapping unnecessary |

## Common Pitfalls

### Pitfall 1: Discord Rate Limit (5 req / 2 sec per webhook)
**What goes wrong:** If a single tick processes multiple trades and notifies Discord for each, the 5-requests-per-2-seconds limit triggers. Discord returns 429 with a `retry_after` field. Silently dropping the 429 means lost notifications.
**Why it happens:** Copy-trader may copy several positions from one tracked trader in one tick.
**How to avoid:** For phase 09 scope (fire-and-forget), log 429 responses with the `retry_after` value. If batching is desired (Claude's discretion), collect all trade events in the tick and send a single embed with multiple fields. A single well-structured embed per tick is sufficient and stays within rate limits.
**Warning signs:** Repeated `discord-webhook:429` log lines; missing notifications when multiple trades execute simultaneously.

### Pitfall 2: Leaderboard `proxyWallet` vs `traderId` Mismatch
**What goes wrong:** If leaderboard wallets are stored with different casing or formatting than what the positions API returns, the `lastSeenPositions` Map key lookups fail and the strategy re-copies on every tick.
**Why it happens:** Ethereum addresses are case-insensitive; the leaderboard returns lowercase `0x...` while the positions API may return checksummed addresses.
**How to avoid:** Normalize all trader IDs to `toLowerCase()` before storing in `traderIds`, `tracked_traders.traderId`, and `lastSeenPositions` Map keys.
**Warning signs:** Positions being "re-copied" on every tick despite no actual new trades from the tracked trader.

### Pitfall 3: env.DISCORD_WEBHOOK_URL undefined in Tests
**What goes wrong:** Tests fail or post to real Discord if the env stub doesn't guard the webhook call.
**Why it happens:** `makeTestEnv` in `test/helpers/mocks.ts` does not include `DISCORD_WEBHOOK_URL` (by design — secrets are excluded from the test env stub pattern).
**How to avoid:** Always guard with `if (env.DISCORD_WEBHOOK_URL)` before calling `notifyDiscord`. Test for both the guarded (undefined) path and a provided URL path using a mock fetch.
**Warning signs:** Real Discord messages appearing during test runs.

### Pitfall 4: Leaderboard API Returns `vol: 0` for Some Entries
**What goes wrong:** When `orderBy: "PNL"`, the leaderboard `vol` field is often 0 (the API only populates the sort field). Storing `vol: 0` as `totalPnl` equivalent or using it for trader quality scoring yields wrong results.
**Why it happens:** The API response confirmed via direct probe: `vol: 0` coexists with large `pnl` values when `orderBy=PNL`. The API appears to return only the primary sort metric.
**How to avoid:** When mapping leaderboard entries to `tracked_traders`, use `pnl` as `totalPnl` and treat `vol` as informational only. Don't filter out entries with `vol: 0`.
**Warning signs:** All leaderboard-sourced traders getting excluded by a `vol > 0` filter.

### Pitfall 5: DO Eviction Loses In-Memory lastSeenPositions Cache
**What goes wrong:** The module-level `lastSeenPositions` Map in `strategy.ts` is lost when the DO is evicted and re-instantiated. On next tick, all positions appear "new" and the strategy re-copies everything.
**Why it happens:** Module-level state in a Durable Object is not persisted to DO storage automatically. DO eviction can happen at any time.
**How to avoid:** This is an existing issue in the strategy, not introduced by this phase. Phase 09 does not need to fix it. However, the leaderboard refresh timestamp (`_lastLeaderboardRefresh`) should be persisted to DO storage (or bot config in D1) rather than the module-level Map, to survive evictions.
**Warning signs:** Unexpected burst of copy trades after a bot restart or extended period of inactivity.

## Code Examples

### Discord Webhook POST (Verified Pattern)
```typescript
// Source: Discord webhook API (https://discord.com/developers/docs/resources/webhook)
// Content-Type: application/json, POST to full webhook URL
const res = await fetch(webhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    embeds: [
      {
        title: "📈 COPY BUY",
        color: 3066993,
        fields: [
          { name: "Market", value: "Will BTC exceed $100k by Dec 2025?", inline: false },
          { name: "Outcome", value: "YES", inline: true },
          { name: "Price", value: "$0.720", inline: true },
          { name: "Shares", value: "50.00", inline: true },
        ],
        footer: { text: "Cash: $800.00 | Equity: $72.00 | Net P&L: -$1.20" },
        timestamp: "2026-03-22T18:00:00.000Z",
      },
    ],
  }),
});
// res.status 204 = success (no content); 429 = rate limited
```

### Polymarket Leaderboard Response (Verified via Direct Probe 2026-03-22)
```typescript
// GET https://data-api.polymarket.com/v1/leaderboard?timePeriod=WEEK&limit=5
// Response (actual):
[
  {
    "rank": "1",
    "proxyWallet": "0x02227b8f5a9636e895607edd3185ed6ee5598ff7",
    "userName": "HorizonSplendidView",
    "xUsername": "",
    "verifiedBadge": false,
    "vol": 0,
    "pnl": 4598456.548919337,
    "profileImage": ""
  },
  // ...
]
// Note: rank is a string, not a number; vol is 0 when ordering by PNL
```

### Leaderboard Refresh Guard Pattern
```typescript
async function maybeRefreshLeaderboard(
  bot: BaseBotDO,
  env: Env,
  config: CopyTraderConfig,
  db: ReturnType<typeof createDb>
): Promise<void> {
  const refreshMs = config.leaderboardRefreshMs ?? 3_600_000;
  const lastRefresh = config._lastLeaderboardRefresh;
  const now = new Date().toISOString();

  if (lastRefresh && Date.now() - new Date(lastRefresh).getTime() < refreshMs) {
    return; // Not due yet
  }

  const entries = await fetchLeaderboard({
    timePeriod: config.leaderboardTimePeriod ?? "WEEK",
    orderBy: "PNL",
    limit: config.leaderboardTopN ?? 10,
  });

  // Upsert to tracked_traders
  const now2 = new Date().toISOString();
  for (const entry of entries) {
    await db.insert(trackedTraders).values({
      platform: "polymarket",
      traderId: entry.proxyWallet.toLowerCase(),
      alias: entry.userName,
      totalPnl: entry.pnl,
      winRate: null,
      isActive: true,
      createdAt: now2,
    }).onConflictDoUpdate({
      target: [trackedTraders.platform, trackedTraders.traderId],
      set: { alias: entry.userName, totalPnl: entry.pnl, isActive: true },
    });
  }

  // Update traderIds in config and persist
  const newTraderIds = entries.map((e) => e.proxyWallet.toLowerCase());
  await (bot as any).updateConfig({
    ...config,
    traderIds: newTraderIds,
    _lastLeaderboardRefresh: now,
  });
}
```

**Note on `onConflictDoUpdate`:** The current `tracked_traders` schema has no unique constraint on `(platform, traderId)`. A Drizzle migration adding this constraint is required to enable upsert semantics, OR use a select-then-insert-or-update pattern.

### Bun Test Pattern for Discord Notification
```typescript
// Intercept global fetch in bun:test
import { mock } from "bun:test";

mock.module("fetch", ...); // Not available in bun:test

// Instead, use: spy on fetch via globalThis
const fetchCalls: RequestInfo[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  fetchCalls.push(input);
  return new Response(null, { status: 204 });
};
// ... test ...
globalThis.fetch = origFetch;
```

**Warning:** Bun test cannot `mock.module` globals like `fetch`. Use `globalThis.fetch` override as a beforeEach/afterEach guard. Alternatively, pass `fetchFn` as an injectable dependency to `notifyDiscord` for easier testing.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| discord.js (Node.js only) | discordeno or native fetch | 2022-2023 | Node.js-dependent libraries don't run in CF Workers |
| Polling leaderboard constantly | Configurable refresh interval | Best practice | Reduces API load; leaderboard changes slowly |
| Module-level trader position cache | DO storage persistence | Known gap (pre-existing) | Phase 09 doesn't address but leaderboard state must not rely on module cache |

## Open Questions

1. **`tracked_traders` unique constraint**
   - What we know: The schema has no `UNIQUE(platform, traderId)` constraint
   - What's unclear: Whether upsert semantics are expected or whether duplicates are tolerated
   - Recommendation: Add a Drizzle migration in this phase to add the unique constraint; enables clean upsert pattern for leaderboard refresh

2. **Cash balance in notification footer**
   - What we know: The DB schema has no `cash` balance column; balance lives in exchange client
   - What's unclear: Whether to fetch balance from the exchange client each time a notification is sent
   - Recommendation: Thread `cashBalance` from the exchange client call that already happens in `processTrader` (via `client.getBalance()`) and pass it to `notifyDiscord`

3. **Discord webhook 204 vs 200 response**
   - What we know: Discord returns HTTP 204 (No Content) on webhook success, not 200
   - What's unclear: Whether the success check should be `res.ok` (covers both) or specific status codes
   - Recommendation: Use `res.ok` (true for 200-299 range) — covers 204 correctly

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in Bun test runner) |
| Config file | none — bun discovers `test/**/*.test.ts` via `bun test` |
| Quick run command | `bun test test/core/discord.test.ts test/strategies/copy-trader.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-01 | notifyDiscord builds correct embed payload and calls fetch | unit | `bun test test/core/discord.test.ts` | ❌ Wave 0 |
| DISC-02 | notifyDiscord is NOT called when DISCORD_WEBHOOK_URL is absent | unit | `bun test test/core/discord.test.ts` | ❌ Wave 0 |
| DISC-03 | Embed contains all required fields (trade type, market, outcome, price, shares, cost, fee, P&L, footer) | unit | `bun test test/core/discord.test.ts` | ❌ Wave 0 |
| DISC-04 | copyTraderTick calls notifyDiscord after successful trade with DISCORD_WEBHOOK_URL set | unit | `bun test test/strategies/copy-trader.test.ts` | ✅ (extend) |
| LEAD-01 | fetchLeaderboard returns LeaderboardEntry[] from mocked API response | unit | `bun test test/core/leaderboard.test.ts` | ❌ Wave 0 |
| LEAD-02 | maybeRefreshLeaderboard upserts traders to tracked_traders table | unit | `bun test test/strategies/copy-trader.test.ts` | ✅ (extend) |
| LEAD-03 | Leaderboard not refreshed if elapsed time < leaderboardRefreshMs | unit | `bun test test/strategies/copy-trader.test.ts` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** `bun test test/core/discord.test.ts test/core/leaderboard.test.ts test/strategies/copy-trader.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/core/discord.test.ts` — covers DISC-01, DISC-02, DISC-03
- [ ] `test/core/leaderboard.test.ts` — covers LEAD-01 with mocked fetch

*(Existing `test/strategies/copy-trader.test.ts` is extended for DISC-04, LEAD-02, LEAD-03 — no new file needed)*

## Sources

### Primary (HIGH confidence)
- Direct API probe: `https://data-api.polymarket.com/v1/leaderboard?timePeriod=WEEK&limit=5` — response shape confirmed 2026-03-22
- `https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings` — endpoint, query parameters, response schema
- Discord webhook rate limits: `https://birdie0.github.io/discord-webhooks-guide/other/rate_limits.html` — 5 req/2 sec per webhook
- Discord webhook POST format: `https://docs.discord.com/developers/resources/webhook` — endpoint and payload structure

### Secondary (MEDIUM confidence)
- Discord embed field limits (256/1024/2048/4096 chars): multiple consistent sources including official Discord safety docs
- Discord 204 success response: confirmed in Discord API community guides

### Tertiary (LOW confidence)
- Discord webhook POST content-type and header requirements: inferred from community guides (Discord official docs did not provide explicit headers)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all tooling in production use
- Architecture: HIGH — Discord webhook API and Polymarket leaderboard both verified live
- Pitfalls: HIGH (DISC/LEAD rate limits, address casing) / MEDIUM (DO eviction state loss — pre-existing issue, well understood)
- Discord payload format: HIGH — core structure confirmed; exact color decimal values are conventional choices

**Research date:** 2026-03-22
**Valid until:** 2026-06-22 (stable APIs; Discord webhook format rarely changes)
