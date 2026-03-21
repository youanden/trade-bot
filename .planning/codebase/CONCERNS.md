# Codebase Concerns

**Analysis Date:** 2026-03-21

## Tech Debt

**Strategy functions cast `bot` to `any` for protected method access:**
- Issue: All 8 strategy files use `(bot as any).config` and `(bot as any).recordTrade(...)` to access protected/private members of `BaseBotDO`. This breaks type safety and means the compiler cannot catch mismatched call signatures.
- Files: `src/worker/bots/cross-arb/strategy.ts`, `src/worker/bots/copy-trader/strategy.ts`, `src/worker/bots/llm-assessor/strategy.ts`, `src/worker/bots/market-maker/strategy.ts`, `src/worker/bots/deep-research/strategy.ts`, `src/worker/bots/weather-arb/strategy.ts`, `src/worker/bots/logical-arb/strategy.ts`, `src/worker/bots/ladder-straddle/strategy.ts`
- Impact: Runtime errors from mismatched arguments will not surface at compile time. `recordTrade` and `config` access are both untyped. Adding new fields to `BotConfig` or `TradeRecord` without updating strategies will silently break.
- Fix approach: Expose a typed `BotContext` interface from `BaseBotDO` that strategy functions receive, containing typed accessors for `config`, `recordTrade`, and other needed members. Strategy signature becomes `(ctx: BotContext, env: Env)`.

**Module-level mutable state in strategy files:**
- Issue: `activeOrders` (market-maker), `lastSeenPositions` (copy-trader), and `ladderState` (ladder-straddle) are module-level `Map` instances. In Cloudflare Workers, module-level state is shared across all Durable Object instances that happen to run in the same isolate. This is an anti-pattern for DO design.
- Files: `src/worker/bots/market-maker/strategy.ts` (line 16), `src/worker/bots/copy-trader/strategy.ts` (line 16), `src/worker/bots/ladder-straddle/strategy.ts` (line 22)
- Impact: If two bot DOs of the same type run in the same isolate (possible), their order state will collide. Ladder and market-maker will manage wrong orders. Copy-trader will think it has seen positions from a different bot instance.
- Fix approach: Move these Maps into instance state on `BaseBotDO` (or a per-strategy state object stored in DO storage), keyed by bot instance ID.

**Daily loss circuit breaker reads wrong column:**
- Issue: `isDailyLossBreached()` in `PortfolioRisk` queries the `positions` table and sums `unrealized_pnl` on closed positions for today. `unrealized_pnl` is only meaningful for open positions; closed positions should have realized PnL tracked in the `trades` table `pnl` column. The breaker is therefore likely to return incorrect (usually zero) results.
- Files: `src/worker/core/risk/portfolio.ts` (lines 106-127)
- Impact: Circuit breaker may never trigger even when daily losses exceed limits, leaving bots running during a bad day.
- Fix approach: Replace with a query against `trades.pnl` filtered to `executedAt >= today`, summing negative PnL values.

**Polymarket `POLYMARKET_API_SECRET` and `POLYMARKET_PASSPHRASE` silently default to empty string:**
- Issue: `createPolymarketClient` in `src/worker/core/exchanges/factory.ts` (lines 43-44) uses `?? ""` for `apiSecret` and `passphrase`, so missing credentials do not throw but will cause silent auth failures at request time.
- Files: `src/worker/core/exchanges/factory.ts` (lines 43-44)
- Impact: Authenticated CLOB requests will fail with HTTP 401/403 at runtime, not at startup. Bots will place no orders without any clear initialization error.
- Fix approach: Add explicit throws for missing `POLYMARKET_API_SECRET` and `POLYMARKET_PASSPHRASE` matching the pattern used for `POLYMARKET_PRIVATE_KEY`.

**Cross-arb records trades before confirming both legs:**
- Issue: In `crossArbTick`, when leg 2 (sell/buy-NO on the expensive exchange) fails, the code logs an error and continues — but leg 1 has already been placed and is noted in a comment as "partial fill risk". Neither trade is rolled back nor is the single-leg open position tracked or hedged.
- Files: `src/worker/bots/cross-arb/strategy.ts` (lines 150-153)
- Impact: A failed leg 2 leaves a naked directional position that is not managed. The bot will not attempt to unwind it, and subsequent ticks will not know to skip this market until it resolves.
- Fix approach: If leg 2 fails, immediately attempt to cancel leg 1 (or sell back at market). Record the single-leg exposure separately and add it to position tracking so risk limits account for it.

**Kalshi `avgEntry` always returns 0:**
- Issue: `KalshiClient.getPositions()` sets `avgEntry: 0` with a comment that the API does not return this value directly. All downstream analytics and PnL calculations that rely on `avgEntry` for Kalshi positions will be wrong.
- Files: `src/worker/core/exchanges/kalshi/client.ts` (line 179)
- Impact: `unrealizedPnl` for Kalshi positions will be calculated as negative the full position value. Portfolio risk exposure figures will be understated (cost basis = 0 means positions appear free).
- Fix approach: Derive avg entry from order fills stored in the `orders` table for the matching `platformId`, or record it at order placement time in the position upsert logic.

**`getBotLeaderboard` N+1 query:**
- Issue: `getBotLeaderboard()` fetches all bot instances, then calls `computeBotMetrics(db, bot.id)` for each bot in a sequential loop. Each `computeBotMetrics` issues its own DB query. With N bots this is N+1 round trips to D1.
- Files: `src/worker/core/risk/analytics.ts` (lines 139-154)
- Impact: Slow `/api/analytics/leaderboard` response at scale. D1 has per-request latency; with 10+ bots this becomes noticeably slow.
- Fix approach: Fetch all trades in a single query grouped by `botInstanceId`, then compute metrics in memory per bot.

**Market-maker `activeOrders` not persisted across DO evictions:**
- Issue: `activeOrders` is a module-level Map in `src/worker/bots/market-maker/strategy.ts`. When the Durable Object is evicted and wakes on an alarm, the Map is empty. The strategy will attempt to check fills against an empty list, find nothing, and place a fresh ladder — leaving the old ladder's orders orphaned on the exchange.
- Files: `src/worker/bots/market-maker/strategy.ts` (lines 15, 207)
- Impact: Accumulation of orphaned resting orders on the exchange across every DO eviction, consuming position capacity and increasing unexpected fills.
- Fix approach: Persist `activeOrders` to DO storage (`ctx.storage.put`) alongside `config` and `running`. Restore it in `hydrate()`.

**Same issue applies to `ladderState` and `lastSeenPositions`:**
- Files: `src/worker/bots/ladder-straddle/strategy.ts` (line 22), `src/worker/bots/copy-trader/strategy.ts` (line 16)
- Impact: Ladder bot will reset the ladder on every eviction, placing duplicate orders. Copy-trader will think all positions are new on wake-up, potentially doubling into every tracked trader's position.
- Fix approach: Same as above — persist and hydrate via DO storage.

**`/api/strategies` endpoint unprotected:**
- Issue: The strategies listing endpoint in `src/worker/index.ts` (lines 46-48) is not under the `/api/*` path that receives the bearer auth middleware, so it requires no authentication even in production.
- Files: `src/worker/index.ts` (lines 46-48)
- Impact: Low severity information disclosure; enumerates available bot strategies to unauthenticated callers.
- Fix approach: Move the route to `/api/strategies` or apply the auth middleware explicitly.

**CORS wildcard in production:**
- Issue: `app.use("*", cors())` in `src/worker/index.ts` (line 19) applies permissive CORS with no origin restriction. This allows any web origin to call the API.
- Files: `src/worker/index.ts` (line 19)
- Impact: Any website can make authenticated requests to the API if a user's bearer token is stored in a place accessible to browser JS (e.g., localStorage). Not critical if the app is purely server-to-server, but risky for browser UI consumers.
- Fix approach: Restrict CORS origins to the app's own domain in production using the `origin` option on `cors()`.

## Known Bugs

**`calculateMaxDrawdown` test comment documents incorrect denominator:**
- Symptoms: The test in `test/core/analytics.test.ts` (lines 37-43) comments that `maxDD / peak` uses the peak at the time of drawdown (25), but the actual implementation uses the global peak, which may differ from the local peak at drawdown time. The test passes because the specific values chosen happen to be equal, masking potential miscalculation for different input shapes.
- Files: `test/core/analytics.test.ts` (line 38), `src/worker/core/risk/analytics.ts` (line 51)
- Trigger: Input where the global peak occurs after the deepest drawdown trough.
- Workaround: None; the test does not catch it.

**Logical-arb `sell` orders may be unsupported on Polymarket CLOB:**
- Symptoms: `logicalArbTick` places orders with `side: "sell"` via `client.placeOrder`. The `PolymarketClient.placeOrder` maps `"sell"` to `"SELL"` in the EIP-712 order data, but the CLOB typically requires the caller to hold the tokens to sell. If the wallet holds no YES tokens, a SELL order will fail silently (returns `status: "failed"` without throwing).
- Files: `src/worker/bots/logical-arb/strategy.ts` (lines 103-118), `src/worker/core/exchanges/polymarket/client.ts` (line 121)
- Trigger: Running logical-arb on Polymarket when no YES/NO tokens are held in the wallet.
- Workaround: None configured; error is logged but bot continues.

## Security Considerations

**Private key stored in environment variable and logged on factory error:**
- Risk: `POLYMARKET_PRIVATE_KEY` is a raw EVM private key passed as an env secret. If a factory error occurs with `env` in scope, a misconfigured logger could serialize it. Not currently happening, but proximity is a risk.
- Files: `src/worker/core/exchanges/factory.ts` (lines 29-46)
- Current mitigation: Logger only serializes explicitly passed `data` objects; `env` is not spread into log calls.
- Recommendations: Audit all log calls in factory and exchange files to confirm `env` is never passed as data. Consider deriving a public address at startup and storing only that for diagnostics.

**Auth bypass in dev mode is not scope-limited:**
- Risk: When `AUTH_TOKEN` is not set, all `/api/*` routes are completely unauthenticated. There is no check to enforce this only runs in a local or development environment.
- Files: `src/worker/index.ts` (lines 22-31)
- Current mitigation: The `ENVIRONMENT = "development"` var in `wrangler.toml` is present but not checked in the auth middleware.
- Recommendations: Assert that `ENVIRONMENT !== "production"` before skipping auth, or require `AUTH_TOKEN` to be set and throw at startup if missing in prod.

**Polymarket private key accessible to all bot strategies via `env`:**
- Risk: All strategy tick functions receive the full `Env` object, giving every strategy access to exchange credentials for both platforms, even if the strategy only uses one.
- Files: All strategy files receiving `env: Env` parameter.
- Current mitigation: Strategies only call `createExchangeClient(env, config.platform)` for their configured platform.
- Recommendations: Pass a pre-constructed `ExchangeClient` to strategy tick functions rather than the raw `env` with all credentials.

## Performance Bottlenecks

**Weather-arb fetches full market list every tick:**
- Problem: `weatherArbTick` calls `client.getMarkets({ limit: 100 })` on every tick to find weather markets. The Kalshi API returns paginated results and a full scan of 100 markets per location per tick interval is wasteful.
- Files: `src/worker/bots/weather-arb/strategy.ts` (lines 122-125)
- Cause: No caching of discovered market IDs between ticks.
- Improvement path: Cache discovered weather market IDs in DO storage after the first scan. Refresh only periodically (e.g., hourly).

**Logical-arb prices every active market sequentially:**
- Problem: `logicalArbTick` fetches up to 100 active markets and then calls `client.getPrice(market.platformId)` for each one in the loop body — a sequential waterfall of N API calls per tick.
- Files: `src/worker/bots/logical-arb/strategy.ts` (lines 52-54)
- Cause: Price fetch inside `for...of` loop with `await`, no batching or parallelism.
- Improvement path: Use `Promise.all` to fetch prices in parallel, or use the order book endpoint which includes bid/ask in one call.

**`getBotLeaderboard` blocks analytics API on every request:**
- Problem: `/api/analytics/leaderboard` is synchronous and computes full metrics for all bots on every HTTP request. See N+1 query concern above.
- Files: `src/worker/core/risk/analytics.ts` (lines 127-155), `src/worker/api/routes/analytics.ts` (lines 52-55)
- Cause: No caching layer; computed fresh every call.
- Improvement path: Read from the pre-computed `bot_metrics` snapshots table instead of recomputing live. The `snapshotBotMetrics` endpoint exists for this purpose; leaderboard should consume it.

**Market-maker issues a `getPositions()` call every tick per market:**
- Problem: `makeMarket()` calls `client.getPositions()` to calculate inventory, then filters to the current market. If there are N configured markets, this is N full portfolio fetches per tick.
- Files: `src/worker/bots/market-maker/strategy.ts` (lines 115-123)
- Cause: No sharing of position data across the per-market loop.
- Improvement path: Fetch positions once before the `for` loop and pass the result in.

## Fragile Areas

**Durable Object state sync between D1 and DO storage:**
- Files: `src/worker/bots/base.ts`, `src/worker/api/routes/bots.ts`
- Why fragile: Bot `status` in D1 (`bot_instances.status`) and the `running` flag in DO storage can diverge. If a bot crashes mid-tick, D1 will say `running` but the DO may not reschedule its alarm. The start/stop routes update D1 status independently of DO RPC calls, with no transactional guarantee. A failed DO RPC call will leave D1 in an incorrect state.
- Safe modification: Always update D1 status only after a successful DO RPC response. Add a reconciliation path that checks heartbeat staleness and marks bots as `error` if the heartbeat has not been updated within 2x the tick interval.
- Test coverage: No tests for DO lifecycle or state recovery.

**Market matcher uses naive Jaccard similarity with no deduplication:**
- Files: `src/worker/core/market/matcher.ts`
- Why fragile: The `O(N*M)` nested loop compares every Polymarket market against every Kalshi market. With 1000+ markets on each platform this will hit D1 query limits and CF Worker CPU time limits. There is also no deduplication — the same pair can be saved multiple times to `market_links` if `findMatches` + `saveMatch` is called repeatedly.
- Safe modification: Add a `UNIQUE` constraint on `(market_id_a, market_id_b)` in the migration before using this at scale. Add an index on `markets(platform, status)`.
- Test coverage: `test/core/matcher.test.ts` exists but tests only similarity scoring, not the full `findMatches` path with DB.

**Weather ticker parsing is regex-based with no test coverage:**
- Files: `src/worker/bots/weather-arb/strategy.ts` (lines 317-337)
- Why fragile: `parseWeatherTicker` uses hand-rolled regex to extract type, threshold, and city from Kalshi ticker strings (e.g., `KXHIGHNY-25MAR21-T52`). If Kalshi changes ticker format (they have historically), all weather markets will be silently skipped (`return null`).
- Safe modification: Log when tickers fail to parse so format changes are visible. Add a test fixture with known ticker strings.
- Test coverage: None.

**LLM response parsing relies on fragile regex fallbacks:**
- Files: `src/worker/bots/llm-assessor/strategy.ts` (lines 225-249), `src/worker/bots/deep-research/strategy.ts` (lines 292-323)
- Why fragile: Both strategies attempt JSON parse, then fall back to decimal regex, then percentage regex. The fallback patterns can match numbers in the reasoning text that are not probability estimates. A response like "with 95 confirmed cases" could match as `0.95`.
- Safe modification: Enforce structured JSON output only. Use a JSON schema validator against the LLM response. Discard non-conforming responses rather than attempting regex fallbacks.
- Test coverage: None for the parsing functions.

## Scaling Limits

**D1 database is local-only in wrangler.toml:**
- Current capacity: `database_id = "local"` in `wrangler.toml` means no production D1 database is configured. Deploying as-is would require a real `database_id`.
- Limit: D1 free tier is 5 GB storage, 5M reads/day, 100K writes/day. With multiple bots writing heartbeats every tick interval plus prices in the `prices` table, write limits could be reached quickly.
- Scaling path: Move price storage out of D1 into a time-series store or Workers KV with TTL. Reduce heartbeat frequency.

**Single Durable Object class for all bot types:**
- Current capacity: All bots share one `BotDO` class. CF allows up to 2,500 active DOs per account by default.
- Limit: Each running bot consumes one DO instance. With the registry supporting 8 strategy types, large deployments with many bot instances could approach limits.
- Scaling path: No immediate concern at current scale. Document the per-account DO limit so operators are aware.

## Dependencies at Risk

**`viem` used in Cloudflare Worker runtime:**
- Risk: `viem` is a browser/Node library. It works in CF Workers with `nodejs_compat` flag (set in `wrangler.toml`), but `viem` assumes certain Node globals that may not always be available or may change behavior in Workers. `parseUnits`, `formatUnits`, and `signTypedData` have been tested to work, but future `viem` major versions may introduce incompatibilities.
- Impact: Polymarket client and order signing would break.
- Migration plan: Monitor `viem` changelog for CF Workers compatibility notes. Consider implementing only the needed EIP-712 signing primitives directly using `crypto.subtle` to remove the dependency.

## Missing Critical Features

**No PnL calculation at trade time:**
- Problem: The `trades.pnl` column exists in the schema but is never written during `recordTrade()` in `BaseBotDO`. It remains `null` for all trades. Analytics functions like `calculateSharpe`, `calculateMaxDrawdown`, and `computeBotMetrics` filter out null PnL values, so they silently compute metrics on zero data.
- Blocks: All analytics endpoints return meaningless data until PnL is computed. Circuit breakers based on daily PnL loss also fail.
- Files: `src/worker/bots/base.ts` (lines 181-191), `src/worker/core/risk/analytics.ts` (lines 79-81)

**No position exit / sell strategy for most bots:**
- Problem: Most bots only place `buy` orders. LLM-assessor, deep-research, and weather-arb have no exit logic — they buy when they see edge but never close positions. Copy-trader has `copySells` config but sell exits for owned positions are not tracked vs. tracker sells. Ladder-straddle places take-profit orders but does not handle stop-loss.
- Blocks: Open positions accumulate indefinitely. Portfolio exposure grows unbounded until risk limits are hit.
- Files: `src/worker/bots/llm-assessor/strategy.ts`, `src/worker/bots/deep-research/strategy.ts`, `src/worker/bots/weather-arb/strategy.ts`

**No rate limiting on exchange API calls:**
- Problem: No retry logic, backoff, or rate limiting is applied to any exchange API call. Kalshi and Polymarket both have rate limits. A burst of ticks (e.g., after a restart with many bots) can exhaust rate limits, causing all API calls to fail with 429 errors until the limit resets.
- Blocks: Bots fail silently under load.
- Files: `src/worker/core/exchanges/kalshi/client.ts`, `src/worker/core/exchanges/polymarket/client.ts`

## Test Coverage Gaps

**Bot Durable Object lifecycle:**
- What's not tested: `BaseBotDO` start/stop, alarm scheduling, hydration after eviction, tick error handling and DB error recording.
- Files: `src/worker/bots/base.ts`, `src/worker/bots/bot-do.ts`
- Risk: State recovery bugs (DO eviction, mismatched D1/DO status) go undetected.
- Priority: High

**Exchange client integration:**
- What's not tested: `KalshiClient` and `PolymarketClient` HTTP calls, order placement, signing logic, error handling for non-2xx responses.
- Files: `src/worker/core/exchanges/kalshi/client.ts`, `src/worker/core/exchanges/polymarket/client.ts`
- Risk: API contract bugs only surface in production when real money is at risk.
- Priority: High

**Strategy tick logic:**
- What's not tested: Any of the 8 strategy tick functions. No mocks for exchange clients, no assertions on trade recording, no risk limit enforcement verification.
- Files: All files in `src/worker/bots/*/strategy.ts`
- Risk: Logic errors in arb detection, position sizing, or risk checks are invisible until live trading.
- Priority: High

**Risk module — `PortfolioRisk`:**
- What's not tested: `checkTrade`, `getTotalExposure`, `getOpenPositionCount`, `isDailyLossBreached`.
- Files: `src/worker/core/risk/portfolio.ts`
- Risk: Misconfigured limits or broken circuit breakers allow over-exposure with no test safety net.
- Priority: High

**API routes:**
- What's not tested: Any HTTP endpoint in `src/worker/api/routes/`. Input validation, error responses, and auth bypass behavior are all untested.
- Files: `src/worker/api/routes/*.ts`
- Risk: Malformed requests can produce unhandled exceptions or incorrect state changes.
- Priority: Medium

---

*Concerns audit: 2026-03-21*
