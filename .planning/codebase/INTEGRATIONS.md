# External Integrations

**Analysis Date:** 2026-03-21

## APIs & External Services

**Prediction Market Exchanges:**
- **Kalshi** - Regulated prediction market exchange; used for market discovery, order placement, portfolio management
  - REST API: `https://api.elections.kalshi.com/trade-api/v2` (prod), `https://demo-api.kalshi.co/trade-api/v2` (demo)
  - WebSocket: `wss://api.elections.kalshi.com/trade-api/ws/v2` (prod)
  - SDK/Client: Custom `KalshiClient` class at `src/worker/core/exchanges/kalshi/client.ts`
  - WebSocket client: `KalshiWebSocket` class at `src/worker/core/exchanges/kalshi/websocket.ts`
  - Auth: RSA-PSS request signing using `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE` headers
  - Credentials env vars: `KALSHI_API_KEY` (key ID), `KALSHI_API_SECRET` (RSA private key PEM)

- **Polymarket** - Decentralized prediction market on Polygon blockchain; used for market discovery, order placement, portfolio management
  - CLOB REST API: `https://clob.polymarket.com`
  - Gamma (market discovery) API: `https://gamma-api.polymarket.com`
  - Data API (positions): `https://data-api.polymarket.com`
  - WebSocket: `wss://ws-subscriptions-clob.polymarket.com/ws/market` and `/ws/user`
  - SDK/Client: Custom `PolymarketClient` class at `src/worker/core/exchanges/polymarket/client.ts`
  - WebSocket client: `src/worker/core/exchanges/polymarket/websocket.ts`
  - Auth: EIP-712 typed data signatures (order signing) + HMAC-SHA256 (API auth) via `viem` library
  - Credentials env vars: `POLYMARKET_PRIVATE_KEY` (Polygon wallet private key hex), `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PASSPHRASE`, `POLYMARKET_ADDRESS`
  - Blockchain: Polygon Mainnet (chain ID 137), USDC (6 decimals) as settlement currency
  - Smart contracts used: CTF Exchange `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`, NEG_RISK_EXCHANGE `0xC5d563A36AE78145C45a50134d48A1215220f80a`

**Weather Data:**
- **NOAA National Weather Service (NWS)** - Free US government weather API; used by `weather-arb` strategy to obtain forecast data for arbitrage against Kalshi weather markets
  - Points API: `https://api.weather.gov/points/{lat},{lon}`
  - Hourly forecast: dynamic URL returned by points endpoint
  - Auth: None (public API), custom `User-Agent: trade-bot/1.0` header required
  - Used in: `src/worker/bots/weather-arb/strategy.ts`

**AI / LLM:**
- **Cloudflare Workers AI** - On-platform AI inference; used by `llm-assessor` and `deep-research` bot strategies for probability estimation of prediction market outcomes
  - Binding: `env.AI` (type `Ai`, Cloudflare-native)
  - Called via: `env.AI.run(modelName, { messages })` in `src/worker/bots/deep-research/strategy.ts` and `src/worker/bots/llm-assessor/strategy.ts`
  - Model is configurable per bot instance via `config.aiModel`
  - Wrangler config: `[ai]` binding named `AI` in `wrangler.toml`

## Data Storage

**Databases:**
- **Cloudflare D1** (SQLite-compatible)
  - Binding: `env.DB` (type `D1Database`)
  - Database name: `trade-bot-db`
  - Client: Drizzle ORM with SQLite dialect, client factory at `src/worker/core/db/client.ts`
  - Schema: `src/worker/core/db/schema.ts`
  - Migrations dir: `drizzle/` (SQL migration files)
  - Tables: `markets`, `market_links`, `prices`, `bot_instances`, `orders`, `trades`, `positions`, `bot_metrics`, `tracked_traders`, `audit_log`

**File Storage:**
- Not detected — no S3, R2, or local file storage integrations

**Caching:**
- In-memory only — `lastSeenPositions` Map in `src/worker/bots/copy-trader/strategy.ts` is scoped to Durable Object instance lifetime
- No external cache (Redis, KV, etc.) detected

## Authentication & Identity

**Auth Provider:**
- Custom bearer token authentication (no third-party identity provider)
  - Implementation: Hono `bearerAuth` middleware in `src/worker/index.ts`
  - Token: `env.AUTH_TOKEN` — if absent, auth is skipped entirely (dev mode)
  - Applied to: all `/api/*` routes except `/api/health`

## Monitoring & Observability

**Error Tracking:**
- None detected — no Sentry, Datadog, or similar integrations

**Logs:**
- Custom structured logger at `src/worker/core/utils/logger.ts`
- Uses `console.log/warn/error` internally; fields are passed as key-value context objects
- Hono's built-in logger middleware applied to `/api/*` routes

## CI/CD & Deployment

**Hosting:**
- Cloudflare Workers (serverless edge compute)
- Static UI assets served via Cloudflare CDN from `dist/ui/`

**CI Pipeline:**
- Not detected (no `.github/`, CircleCI, or similar config found)

**Deploy command:**
```bash
vite build && wrangler deploy
```

## Environment Configuration

**Required env vars (production):**
- `POLYMARKET_PRIVATE_KEY` - Polygon wallet private key (hex)
- `POLYMARKET_API_KEY` - Polymarket CLOB API key
- `POLYMARKET_API_SECRET` - Polymarket CLOB API secret (HMAC signing)
- `POLYMARKET_PASSPHRASE` - Polymarket CLOB passphrase
- `POLYMARKET_ADDRESS` - Polygon wallet address
- `KALSHI_API_KEY` - Kalshi API key ID
- `KALSHI_API_SECRET` - Kalshi RSA private key in PEM format

**Optional env vars:**
- `AUTH_TOKEN` - Bearer token for API auth (absent = no auth, dev mode)
- `ENVIRONMENT` - Set to `"development"` by default in `wrangler.toml` `[vars]` section

**Secrets location:**
- Cloudflare Workers secrets (set via `wrangler secret put`) — not committed to source
- Defined as optional fields on the `Env` interface in `env.d.ts`

## Webhooks & Callbacks

**Incoming:**
- None detected — the application does not expose webhook receiver endpoints

**Outgoing:**
- Kalshi WebSocket subscription: ticker channel for real-time price updates (`src/worker/core/exchanges/kalshi/websocket.ts`)
- Polymarket WebSocket subscriptions: market and user channels (`src/worker/core/exchanges/polymarket/websocket.ts`)
- These are bot-initiated connections, not traditional outgoing webhooks

---

*Integration audit: 2026-03-21*
