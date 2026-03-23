/** Trade event types for Discord notification embeds. */
export type TradeType = "COPY_BUY" | "COPY_SELL" | "TAKE_PROFIT" | "STOP_LOSS";

/** Emoji for each trade type used in the embed title. */
const TRADE_EMOJI: Record<TradeType, string> = {
  COPY_BUY: "📈",
  COPY_SELL: "📉",
  TAKE_PROFIT: "✅",
  STOP_LOSS: "🛑",
};

/** Discord embed sidebar color for each trade type (decimal integer). */
const TRADE_COLOR: Record<TradeType, number> = {
  COPY_BUY: 3066993,    // green
  COPY_SELL: 10038562,  // orange
  TAKE_PROFIT: 3066993, // green
  STOP_LOSS: 15158332,  // red
};

/** Trade event data passed to notifyDiscord for embed construction. */
export interface TradeNotification {
  tradeType: TradeType;
  marketName: string;
  outcome: "yes" | "no";
  price: number;
  shares: number;
  cost: number;
  fee: number;
  /** Realized P&L — present on sells, absent on buys. */
  pnl?: number;
  /** Originating trader address for copy trades (full 0x address). */
  traderAddress?: string;
  /** Market category label (e.g. "CRYPTO", "POLITICS"). */
  category?: string;
  /** ISO-8601 timestamp of the trade execution. */
  timestamp: string;
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
 * Post a trade notification to a Discord webhook as a rich embed.
 * Fire-and-forget — errors are logged but never thrown.
 * @param webhookUrl - Full Discord webhook URL from env.DISCORD_WEBHOOK_URL
 * @param notification - Trade event data to format as embed
 */
export async function notifyDiscord(
  webhookUrl: string,
  notification: TradeNotification
): Promise<void> {
  const {
    tradeType,
    marketName,
    outcome,
    price,
    shares,
    cost,
    fee,
    pnl,
    traderAddress,
    category,
    timestamp,
    portfolioSummary,
  } = notification;

  const emoji = TRADE_EMOJI[tradeType];
  const color = TRADE_COLOR[tradeType];
  const label = tradeType.replace("_", " ");

  // 1. Build embed fields array (required fields first)
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "Market", value: marketName.slice(0, 1024), inline: false },
    { name: "Outcome", value: outcome.toUpperCase(), inline: true },
    { name: "Price", value: `$${price.toFixed(3)}`, inline: true },
    { name: "Shares", value: shares.toFixed(2), inline: true },
    { name: "Cost", value: `$${cost.toFixed(2)}`, inline: true },
    { name: "Fee", value: `$${fee.toFixed(2)}`, inline: true },
  ];

  // 2. Conditionally add optional fields
  if (pnl !== undefined) {
    fields.push({
      name: "P&L",
      value: `$${pnl.toFixed(2)}`.slice(0, 1024),
      inline: true,
    });
  }

  if (traderAddress) {
    const abbrev = `${traderAddress.slice(0, 6)}...${traderAddress.slice(-4)}`;
    fields.push({ name: "Copied Trader", value: abbrev, inline: true });
  }

  if (category) {
    fields.push({
      name: "Category",
      value: `[${category}]`.slice(0, 1024),
      inline: true,
    });
  }

  // 3. Build footer text from portfolio summary
  const { cash, equity, realizedPnl, totalFees, netPnl, openPositions, totalTrades } =
    portfolioSummary;
  const footerText = (
    `Cash: $${cash.toFixed(2)} | Equity: $${equity.toFixed(2)} | ` +
    `Realized P&L: $${realizedPnl.toFixed(2)} | Fees: $${totalFees.toFixed(2)} | ` +
    `Net: $${netPnl.toFixed(2)} | Positions: ${openPositions} | Trades: ${totalTrades}`
  ).slice(0, 2048);

  const payload = {
    embeds: [
      {
        title: `${emoji} ${label}`,
        color,
        fields,
        footer: { text: footerText },
        timestamp,
      },
    ],
  };

  // 4. POST to Discord webhook — fire-and-forget, never throw
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Log warning but do not throw — notification failure must not break trade execution
      console.warn(`discord-webhook:${res.status}`);
    }
  } catch {
    // Network errors silently swallowed — trade execution is unaffected
  }
}
