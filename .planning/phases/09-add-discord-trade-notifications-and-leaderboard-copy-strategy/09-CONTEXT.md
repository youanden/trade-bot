# Phase 09 Context: Discord Trade Notifications & Leaderboard Copy Strategy

## Decisions (Locked)

### D-01: Discord trade notifications use webhooks via native fetch POST from Workers

**Rationale:** Webhooks are one-way fire-and-forget HTTP POSTs. No persistent connections, no WebSocket, no bot process needed. Works natively in Cloudflare Workers with zero external dependencies.

**Implication:** The notification service is a simple utility function that builds a JSON payload and calls `fetch(webhookUrl, { method: "POST", body: ... })`.

### D-02: No Discord library needed for webhook notifications

**Rationale:** Discord webhook API is a single POST endpoint accepting JSON with `content` and/or `embeds` fields. Using a library for this adds unnecessary dependency weight.

**Implication:** DISC-01 through DISC-04 use only native fetch. No npm packages for Discord interaction in phase 09 scope.

### D-03: If interactive Discord bot features are needed later, use discordeno

**Rationale:** discordeno is designed for serverless/edge runtimes, unlike discord.js which requires Node.js APIs. It can run in Deno, Bun, and Cloudflare Workers.

**Implication:** This is deferred -- phase 09 scope covers webhooks only. Interactive bot features (slash commands, presence, channel management) would be a future phase using discordeno.

## Deferred Ideas

- Interactive Discord bot with slash commands for leaderboard queries and copy strategy management (future phase, would use discordeno)
- Discord bot presence/status display
- Channel management or role-based notifications
- Rich thread-based trade discussion per market

## Claude's Discretion

- Exact emoji set for trade type indicators
- Whether to use Discord embeds vs plain text content for message formatting
- Retry logic for webhook delivery failures
- Message batching strategy if multiple trades execute in same tick
- Rate limiting approach for Discord webhook API (30 requests/minute per channel)

## Essential Features (from todo spec)

- **Trade type indicators:** COPY BUY, COPY SELL, TAKE PROFIT, STOP LOSS
- **Message fields:** market name, outcome, price, shares, cost, fees, P&L on sells, trader address (abbreviated), timestamp
- **Portfolio summary footer:** cash, equity, realized P&L, fees, net, position count, trade count
- **Optional category tags:** [sports], [crypto], etc.
