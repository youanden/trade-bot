---
created: 2026-03-22T01:37:34.618Z
title: Add Discord trade notifications and leaderboard copy strategy
area: api
files:
  - src/worker/bots/copy-trader/strategy.ts
  - src/worker/core/exchanges/polymarket/client.ts
  - src/worker/index.ts
---

## Problem

Two related features needed for the copy trading bot:

1. **Discord Trade Notifications**: Post formatted trade messages to a Discord channel via webhook when the bot executes trades. Messages should include:
   - Trade type indicator (COPY BUY, COPY SELL, TAKE PROFIT, STOP LOSS)
   - Market name and outcome target
   - Price, shares, cost, fees
   - P&L on sells (realized gain/loss)
   - Tracked trader address (abbreviated)
   - Timestamp
   - Portfolio summary footer: cash, equity, realized P&L, fees, net, position count, trade count
   - Optional category tags like [sports], [crypto]

2. **Polymarket Leaderboard-Based Copy Strategy**: Use Polymarket's top trader leaderboard data to dynamically select which traders to copy, rather than relying on a static list. This would allow the bot to follow high-performing traders based on their leaderboard ranking and recent performance metrics.

Example message format is well-defined (see Discord chat examples in the todo creation context) — structured with emoji indicators, separator lines, and consistent data fields.

## Solution

1. Create a Discord webhook notification service in `src/worker/core/utils/` that formats trade data into the emoji-rich message structure shown in the examples
2. Hook into the copy trader strategy's trade execution flow to fire notifications after each trade
3. Add Polymarket leaderboard API integration to `src/worker/core/exchanges/polymarket/` to fetch and rank top traders
4. Use leaderboard data in copy trader config to dynamically update the tracked traders list
5. Store Discord webhook URL as a Cloudflare Workers secret binding
