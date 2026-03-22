# Polymarket Ecosystem vs Trade-Bot: Architecture Comparison

## Summary of Top Suggestions

| # | Suggestion | Dimension | Impact | Effort | Priority |
|---|-----------|-----------|--------|--------|----------|
| 1 | Add transaction polling/confirmation lifecycle to order management | Order Management | High | Medium | 1 |
| 2 | Implement HMAC-based API authentication with proper header signing | Exchange Client | High | Medium | 2 |
| 3 | Add WebSocket real-time data feed for live price streaming | Exchange Client | High | Medium | 3 |
| 4 | Detect neg-risk vs standard exchange contract per market | Exchange Client | High | Low | 4 |
| 5 | Add structured HTTP error handling with status/payload extraction | Exchange Client | Medium | Low | 5 |
| 6 | Add Safe/Proxy wallet abstraction for on-chain transaction batching | Exchange Client | Medium | High | 6 |
| 7 | Add `rewardsMinSize` and `rewardsMaxSpread` fields from Gamma API | Data Models | Low | Low | 7 |
| 8 | Implement proper test infrastructure (not placeholder tests) | Testing | Medium | Medium | 8 |

---

## 1. Exchange Client Layer

### What Polymarket Does

Polymarket's exchange client ecosystem is split across multiple focused repos:

- **`builder-relayer-client`** (TypeScript): A `RelayClient` class that handles Safe/Proxy wallet transaction submission through a relayer. Uses an `HttpClient` wrapper around axios with structured error extraction (status, statusText, response data). Supports both Safe and Proxy transaction types via `RelayerTxType` enum. Authentication is handled through `BuilderConfig` which generates HMAC-signed headers per-request.

- **`builder-signing-sdk`** (TypeScript): HMAC-based request signing using `node:crypto`. Builds signatures from `timestamp + method + requestPath + body`, base64-encodes the HMAC-SHA256, and converts to URL-safe base64. Supports both local signing (in-process) and remote signing (delegating to a signing server via HTTP).

- **`real-time-data-client`** (TypeScript): WebSocket client for live market data with auto-reconnect, ping/pong keep-alive, connection status callbacks (`CONNECTING`, `CONNECTED`, `DISCONNECTED`), and topic-based subscription/unsubscription. Uses `isomorphic-ws` for cross-platform compatibility.

- **`agents/polymarket.py`** (Python): Uses `py-clob-client` (Polymarket's official Python SDK) for CLOB interaction. Creates/derives API credentials from wallet, initializes on-chain approvals for CTF Exchange, Neg Risk CTF Exchange, and Neg Risk Adapter separately.

**Key patterns:**
- HMAC signature = `base64(HMAC-SHA256(base64decode(secret), timestamp + method + path + body))`
- Separate contract addresses for standard vs neg-risk exchange
- Builder headers include: `POLY-ADDRESS`, `POLY-SIGNATURE`, `POLY-TIMESTAMP`, `POLY-NONCE`, `POLY-API-KEY`, `POLY-PASSPHRASE`
- Explicit approval flows for USDC and CTF tokens per exchange contract

### What We Do

Our `PolymarketClient` in `src/worker/core/exchanges/polymarket/client.ts`:
- Implements `ExchangeClient` interface with market discovery, pricing, trading, and portfolio methods
- Uses `viem` for EIP-712 order signing (same chain, same domain as Polymarket's contract)
- CLOB auth via `deriveApiCredentials()` using EIP-712 `ClobAuth` typed data
- Custom `clobFetch()` wrapper for authenticated CLOB API calls
- Maps between Gamma API format and our unified `MarketInfo` type

### Gaps and Improvement Opportunities

**Gap 1: No neg-risk exchange detection.** Our code has a `TODO: detect negRisk per market` comment at line 144. Polymarket uses separate contract addresses for neg-risk markets (`0xC5d563A36AE78145C45a50134d48A1215220f80a`) vs standard CTF exchange (`0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`). Orders signed against the wrong exchange contract will fail.

- **Suggested action:** Add `isNegRisk` field to market metadata from Gamma API (the field `negRiskMarketID` exists in their API responses). Route order signing to the correct exchange contract based on this flag.
- **Effort:** Low
- **Impact:** High (prevents order failures on neg-risk markets)

**Gap 2: No real-time WebSocket data feed.** We only use REST polling. Polymarket provides a WebSocket endpoint (`wss://ws-live-data.polymarket.com`) with topic subscriptions for live prices, order fills, and market updates.

- **Suggested action:** Integrate `real-time-data-client` patterns: WebSocket with auto-reconnect, ping/pong keep-alive, and status callbacks. Our `ExchangeWebSocketHandlers` interface already exists but has no implementation.
- **Effort:** Medium
- **Impact:** High (reduces latency for arb and market-maker strategies)

**Gap 3: HMAC authentication not matching official SDK pattern.** Our CLOB auth derives credentials via EIP-712 but the actual per-request signing should use HMAC-SHA256 as shown in `builder-signing-sdk`. We should verify our `clobFetch` implementation matches the official HMAC signing protocol.

- **Suggested action:** Audit `clobFetch` to ensure HMAC header generation matches `buildHmacSignature()` from the official SDK: URL-safe base64, correct message format (`timestamp + method + path + body`).
- **Effort:** Low
- **Impact:** High (auth failures cause silent order rejections)

**Gap 4: No structured HTTP error handling.** Polymarket's `HttpClient` extracts `{ status, statusText, data }` from error responses and logs them as structured objects. Our `clobFetch` throws generic errors.

- **Suggested action:** Wrap fetch errors to extract HTTP status, response body, and structured error details. Map to typed error classes (e.g., `RateLimitError`, `AuthError`, `OrderRejectedError`).
- **Effort:** Low
- **Impact:** Medium (better debugging, proper retry logic)

---

## 2. Order Management

### What Polymarket Does

- **Transaction lifecycle:** The `RelayClient` uses a `pollUntilState()` method that polls transaction status until it reaches `STATE_MINED` or `STATE_CONFIRMED`, with configurable max polls and frequency. The `ClientRelayerTransactionResponse` wraps results with a `.wait()` method that auto-polls up to 100 times.

- **Transaction states:** Clear enum: `STATE_NEW -> STATE_EXECUTED -> STATE_MINED -> STATE_CONFIRMED` (happy path) or `STATE_FAILED` / `STATE_INVALID` (error paths).

- **Batch execution:** The `execute()` method accepts an array of `Transaction[]` and batches them into a single Safe/Proxy multi-send transaction, reducing gas costs and ensuring atomicity.

- **Nonce management:** Explicit nonce fetching (`getNonce()`, `getRelayPayload()`) before each transaction submission, preventing nonce collisions.

### What We Do

- Record orders in the `orders` table with status tracking (`pending -> open -> filled -> partial -> cancelled -> failed`)
- Record fills in the `trades` table linked to orders
- Upsert `positions` table on each trade
- No transaction polling -- we submit and trust the immediate API response
- No batch transaction support
- No explicit nonce management (salt is random per order)

### Gap and Improvement Opportunity

**Gap: No order confirmation polling.** After submitting an order to the CLOB, we rely on the immediate response. If the order is matched asynchronously, we may miss fill confirmations or incorrectly report status.

- **Suggested action:** Add an order confirmation service that polls `getOrder()` for pending orders until they reach a terminal state. Implement with exponential backoff. Update the `orders` and `trades` tables based on confirmed state transitions. Consider a state machine enum matching Polymarket's lifecycle.
- **Effort:** Medium
- **Impact:** High (prevents phantom positions, ensures accurate P&L)

---

## 3. Risk Management

### What Polymarket Does

Polymarket's open-source repos contain **no risk management layer**. The `agents` repo has basic position sizing via LLM (the superforecaster determines bet size as a percentage of USDC balance), but there are no:
- Position limits
- Exposure caps
- Daily loss circuit breakers
- Kelly criterion sizing
- Portfolio-level risk aggregation

The `Trader.maintain_positions()` and `Trader.incentive_farm()` methods are empty stubs.

### What We Do

We have a comprehensive risk layer:
- `PortfolioRisk` class: position limits, max total exposure, per-trade max loss, max open positions, daily loss circuit breaker
- Kelly criterion sizing (`kellyFraction`, `kellySize`) with configurable fraction (default quarter-Kelly)
- `RiskCheck` result type with `allowed`, `reason`, and `suggestedSize` fields
- Risk checks run per-tick before any order placement
- `getLimitsForBot()` provides per-bot-type limit overrides

### Gap and Improvement Opportunity

**Our risk layer is significantly more mature than Polymarket's open-source offering.** No gaps to close here -- this is an area of strength.

One minor enhancement from observing their pattern: their trade execution guards against zero-transaction batches (`if (txns.length == 0) throw new Error("no transactions to execute")`). We should ensure similar pre-condition checks exist in our order placement flow.

- **Suggested action:** Add guard clauses to `placeOrder` for edge cases: zero size, price outside [0,1] range, expired markets.
- **Effort:** Low
- **Impact:** Low (defensive programming)

---

## 4. Data Models

### What Polymarket Does

- **Gamma API markets** include fields we may not capture: `rewardsMinSize`, `rewardsMaxSpread`, `spread`, `funded`, `clobTokenIds`, `negRiskMarketID`, `conditionId`
- **CLOB token IDs** are separate from market IDs -- each outcome (Yes/No) has its own token ID
- **Transaction model** tracks: `transactionID`, `transactionHash`, `from`, `to`, `proxyAddress`, `data`, `nonce`, `value`, `state`, `type`, `metadata`, `createdAt`, `updatedAt`
- **ClobApiKeyCreds** tracks: `key`, `secret`, `passphrase` as a structured credential object
- Uses Pydantic models in Python for validation (`SimpleMarket`, `SimpleEvent`, `Market`, `PolymarketEvent`)

### What We Do

- `markets` table: `id`, `platform`, `platformId`, `title`, `description`, `category`, `status`, `resolution`, `endDate`, timestamps
- `orders` table: `platformOrderId`, `side`, `outcome`, `price`, `size`, `filledSize`, `status`
- `positions` table: `outcome`, `size`, `avgEntry`, `currentPrice`, `unrealizedPnl`, `status`
- `trades` table: `filledPrice`, `filledSize`, `fee`, `pnl`, `tradeReason`
- `market_links` for cross-platform matching
- `bot_metrics` for performance tracking

### Gap and Improvement Opportunity

**Gap 1: Missing `clobTokenIds` and `negRiskMarketID` in market schema.** These are critical for correct order routing on Polymarket. We store `platformId` but not the per-outcome token IDs that the CLOB API requires.

- **Suggested action:** Add `clobTokenIds` (JSON text) and `negRiskMarketId` (text, nullable) columns to the `markets` table. Populate during market sync from Gamma API.
- **Effort:** Low
- **Impact:** Medium (enables correct order routing)

**Gap 2: No `rewardsMinSize` / `rewardsMaxSpread` tracking.** These fields from the Gamma API define minimum order size and maximum spread to qualify for liquidity rewards. Market-maker and ladder-straddle strategies could use these to optimize for reward eligibility.

- **Suggested action:** Add `rewardsMinSize` and `rewardsMaxSpread` columns to markets or store in the `meta` JSON field.
- **Effort:** Low
- **Impact:** Low (optimization, not correctness)

---

## 5. API Patterns

### What Polymarket Does

- **Authentication:** HMAC-SHA256 request signing with timestamp, method, path, and body. Supports both local and remote signing configurations. Builder headers include 6 distinct fields.
- **Rate limiting:** Not explicitly handled in client code -- no retry-after logic or rate limit detection.
- **Pagination:** Gamma API uses `limit` + `offset` pattern. The `GammaMarketClient` implements cursor-based pagination in `get_all_current_markets()` with a `while True` loop checking `len(batch) < limit` as stop condition.
- **Error handling:** Axios-based error extraction with structured payloads. Pre-defined error constants (`SIGNER_UNAVAILABLE`, `SAFE_NOT_DEPLOYED`, etc.).
- **Polling:** `pollUntilState()` with configurable max polls (default 10) and poll frequency (default 2000ms, minimum 1000ms).

### What We Do

- CLOB auth via EIP-712 derived credentials with HMAC signing in `clobFetch`
- Cursor-based pagination in `getMarkets()` using `offset` parameter
- Basic error throwing on non-OK responses
- No explicit rate limiting or retry logic
- No polling for order confirmation

### Gap and Improvement Opportunity

**Gap 1: No rate limit handling.** If the CLOB API returns 429, we throw a generic error. Strategies may attempt rapid re-submission, causing cascading failures.

- **Suggested action:** Detect 429 responses, extract `Retry-After` header, implement exponential backoff with jitter. Add a request queue with rate limiting (e.g., max N requests per second).
- **Effort:** Medium
- **Impact:** Medium (prevents API bans during high-frequency operation)

**Gap 2: No retry logic for transient failures.** Network errors, 502/503 responses, and timeouts are treated as permanent failures.

- **Suggested action:** Add configurable retry with exponential backoff for idempotent operations (GET requests, order status checks). Non-idempotent operations (POST order) should only retry on network errors, not on API-level rejections.
- **Effort:** Medium
- **Impact:** Medium (resilience in production)

---

## 6. Testing Patterns

### What Polymarket Does

- **`agents` repo:** Contains a single `test.py` file with 3 trivial string method tests (`test_upper`, `test_isupper`, `test_split`). No actual trading logic tests. No mocks, no fixtures, no integration tests.
- **`builder-signing-sdk`:** Uses Vitest with tests for HMAC signing (`hmac.test.ts`), config validation (`config.test.ts`), and signer operations (`signer.test.ts`). This is the only repo with meaningful test coverage.
- **`builder-relayer-client`:** Has a signature test (`signatures/index.test.ts`) but no client integration tests.
- **`real-time-data-client`:** No tests.
- **No mock exchange clients, no simulated trading tests, no backtest infrastructure.**

### What We Do

- Vitest + in-memory SQLite for unit tests
- Tests for Kelly criterion (`kelly.test.ts`), analytics (`analytics.test.ts`), market matching (`matcher.test.ts`)
- Phase-based test infrastructure with `makeMockBot`, `TestDb`, and `SimExchangeClient`
- `SimulatedBot` class that duck-types `BaseBotDO` for backtest use
- `PriceFeed` with no-lookahead enforcement for simulation correctness
- Strategy tests that exercise through the `StrategyTickFn` interface

### Gap and Improvement Opportunity

**Our testing infrastructure is vastly superior to Polymarket's open-source repos.** Their `agents` repo has essentially no meaningful tests. Our simulation layer (SimExchangeClient, SimulatedBot, PriceFeed) goes well beyond anything in their public code.

One pattern worth adopting from `builder-signing-sdk`: their Vitest config and test structure for cryptographic operations. We should ensure our HMAC signing logic (used in `clobFetch`) has dedicated unit tests with known test vectors.

- **Suggested action:** Add unit tests for CLOB HMAC signature generation using known input/output pairs from Polymarket's test suite.
- **Effort:** Low
- **Impact:** Medium (prevents auth regressions)

---

## 7. Overall Architecture

### What Polymarket Does

- **Microservice/library ecosystem:** Each concern is a separate npm package or Python library. `builder-relayer-client` handles transaction relay, `builder-signing-sdk` handles auth, `real-time-data-client` handles WebSocket data, `py-clob-client` handles CLOB interaction.
- **No central orchestrator:** The `agents` repo loosely connects components via a `Trader` class that sequences: discover events -> filter -> find markets -> evaluate -> execute. No state machine, no alarm loop, no persistent scheduling.
- **LLM-first strategy selection:** The `Executor` uses GPT to evaluate markets, generate superforecasts, and select trades. Strategies are not pluggable -- the LLM is the strategy.
- **Python + TypeScript split:** Trading logic in Python, infrastructure SDKs in TypeScript.
- **No persistent state management:** Uses ChromaDB for RAG-based event filtering, but no SQL database for trade history, positions, or metrics.

### What We Do

- **Monolithic Cloudflare Worker** serving API + UI with Durable Objects for bot isolation
- **Strategy pattern** with pluggable tick functions registered by string key
- **Persistent state** via D1 (SQLite) with Drizzle ORM
- **Alarm-based scheduling** via Durable Object alarms for self-rescheduling tick loops
- **8 distinct strategy types** covering arb, market-making, LLM assessment, copy trading

### Gap and Improvement Opportunity

**Our architecture is more production-ready** than Polymarket's open-source offerings. Their public repos are SDKs and a prototype agent, not a production trading system.

**One valid pattern to adopt:** Their separation of concerns between auth/signing and HTTP transport. Our `clobFetch` combines authentication, HTTP transport, and error handling in one method. Separating the HMAC signer into its own utility would improve testability and allow reuse if we add a second auth scheme (e.g., for Kalshi API key rotation).

- **Suggested action:** Extract HMAC signing from `clobFetch` into a standalone `PolymarketSigner` utility class. Test it independently with known vectors.
- **Effort:** Low
- **Impact:** Low (code quality, testability)

---

## Conclusions

Our trade-bot codebase is architecturally more mature than Polymarket's open-source repositories in most dimensions, particularly risk management, testing, state persistence, and strategy orchestration. Polymarket's public repos are SDK-level libraries and a prototype agent, not a production trading platform.

The highest-impact improvements to adopt from their ecosystem are:

1. **Order confirmation polling** -- prevents phantom positions and ensures accurate trade recording
2. **Proper HMAC auth with neg-risk exchange detection** -- prevents order failures on a significant subset of Polymarket markets
3. **WebSocket real-time data** -- reduces latency for time-sensitive strategies (arb, market-making)
4. **Structured HTTP error handling and retry logic** -- improves resilience for production operation

These four items would close the primary gaps between our exchange client layer and what Polymarket's official SDKs provide.
