import { createDb } from "../../core/db/client";
import { trackedTraders, positions, trades } from "../../core/db/schema";
import { eq, and } from "drizzle-orm";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import { notifyDiscord } from "../../core/notifications/discord";
import type { TradeNotification } from "../../core/notifications/discord";
import { fetchLeaderboard } from "../../core/exchanges/polymarket/leaderboard";
import type { ExchangeClient } from "../../core/exchanges/types";
import type { BaseBotDO, TradeRecord } from "../base";
import type { CopyTraderConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "copy-trader" });

// In-memory cache of last-seen positions per trader (DO-scoped)
const lastSeenPositions = new Map<
  string,
  Array<{ marketId: string; outcome: string; size: number }>
>();

/**
 * Copy-trader strategy tick function.
 *
 * On each tick:
 * 1. Optionally refresh tracked traders from leaderboard (if leaderboardMode enabled)
 * 2. Fetch tracked traders' current positions from the exchange
 * 3. Compare against last-seen positions to detect new trades
 * 4. Mirror new trades with risk-adjusted sizing
 * 5. Post Discord notification after each successful trade (if webhook configured)
 */
export async function copyTraderTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as CopyTraderConfig;
  if (!config?.traderIds?.length && !config?.leaderboardMode) {
    log.info("tick:no-traders-configured");
    return;
  }

  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("copy-trader"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  // Refresh leaderboard if in leaderboard mode
  if (config.leaderboardMode) {
    await maybeRefreshLeaderboard(bot, env, config, db);
  }

  // After potential leaderboard refresh, traderIds may have been updated
  if (!config?.traderIds?.length) {
    log.info("tick:no-traders-after-leaderboard-refresh");
    return;
  }

  // Create exchange client for trading
  let client: ExchangeClient;
  try {
    client = createExchangeClient(env, config.platform);
  } catch (err) {
    log.error("tick:client-init-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const traderId of config.traderIds) {
    try {
      await processTrader(bot, env, config, traderId, risk, client, db);
    } catch (err) {
      log.error("tick:trader-error", {
        traderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Refresh tracked traders from the Polymarket leaderboard when the refresh
 * interval has elapsed. Updates config.traderIds and persists the timestamp.
 */
async function maybeRefreshLeaderboard(
  bot: BaseBotDO,
  env: Env,
  config: CopyTraderConfig,
  db: ReturnType<typeof createDb>
): Promise<void> {
  const refreshMs = config.leaderboardRefreshMs ?? 3_600_000;
  const lastRefresh = config._lastLeaderboardRefresh;
  const now = Date.now();

  if (lastRefresh && now - new Date(lastRefresh).getTime() < refreshMs) {
    return; // Not due yet
  }

  let entries;
  try {
    entries = await fetchLeaderboard({
      timePeriod: config.leaderboardTimePeriod ?? "WEEK",
      orderBy: "PNL",
      limit: config.leaderboardTopN ?? 10,
    });
  } catch (err) {
    log.error("leaderboard:fetch-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const nowIso = new Date().toISOString();
  for (const entry of entries) {
    // Use select-then-insert/update pattern since tracked_traders has no unique constraint
    const existing = await db
      .select()
      .from(trackedTraders)
      .where(
        and(
          eq(trackedTraders.platform, "polymarket"),
          eq(trackedTraders.traderId, entry.proxyWallet)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(trackedTraders)
        .set({ alias: entry.userName, totalPnl: entry.pnl, isActive: true })
        .where(eq(trackedTraders.id, existing[0].id));
    } else {
      await db.insert(trackedTraders).values({
        platform: "polymarket",
        traderId: entry.proxyWallet,
        alias: entry.userName,
        totalPnl: entry.pnl,
        winRate: null,
        isActive: true,
        createdAt: nowIso,
      });
    }
  }

  // Update traderIds and persist last refresh time
  const newTraderIds = entries.map((e) => e.proxyWallet);
  config.traderIds = newTraderIds;
  config._lastLeaderboardRefresh = new Date().toISOString();

  // Persist updated config via bot.updateConfig if available
  if (typeof (bot as any).updateConfig === "function") {
    await (bot as any).updateConfig(config);
  }

  log.info("leaderboard:refreshed", { traderCount: entries.length });
}

/**
 * Build a portfolio summary snapshot for Discord notification embeds.
 */
async function buildPortfolioSummary(
  db: ReturnType<typeof createDb>,
  botInstanceId: number | undefined,
  cashBalance: number
): Promise<TradeNotification["portfolioSummary"]> {
  const openPos = botInstanceId
    ? await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.botInstanceId, botInstanceId),
            eq(positions.status, "open")
          )
        )
    : [];
  const allTrades = botInstanceId
    ? await db
        .select()
        .from(trades)
        .where(eq(trades.botInstanceId, botInstanceId))
    : [];

  const equity = openPos.reduce(
    (sum, p) => sum + p.size * (p.currentPrice ?? p.avgEntry),
    0
  );
  const realizedPnl = allTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const totalFees = allTrades.reduce((sum, t) => sum + (t.fee ?? 0), 0);

  return {
    cash: cashBalance,
    equity: Math.round(equity * 100) / 100,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    netPnl: Math.round((realizedPnl - totalFees) * 100) / 100,
    openPositions: openPos.length,
    totalTrades: allTrades.length,
  };
}

async function processTrader(
  bot: BaseBotDO,
  env: Env,
  config: CopyTraderConfig,
  traderId: string,
  risk: PortfolioRisk,
  client: ExchangeClient,
  db: ReturnType<typeof createDb>
): Promise<void> {
  // Fetch trader's current positions from Data API
  const currentPositions = await fetchTraderPositions(
    config.platform,
    traderId
  );

  const prevPositions = lastSeenPositions.get(traderId) ?? [];

  // Detect new or increased positions
  for (const pos of currentPositions) {
    const prev = prevPositions.find(
      (p) => p.marketId === pos.marketId && p.outcome === pos.outcome
    );

    const prevSize = prev?.size ?? 0;
    const sizeDelta = pos.size - prevSize;

    if (sizeDelta > 0) {
      // New or increased position — copy it
      const copySize = Math.min(
        sizeDelta * config.sizeFraction,
        config.maxPositionSize
      );

      if (copySize < 1) continue;

      // Get live price from exchange
      const livePrice = await client.getPrice(pos.marketId).catch(() => null);
      if (!livePrice) {
        log.warn("tick:price-fetch-failed", { marketId: pos.marketId });
        continue;
      }

      const estimatedPrice =
        pos.outcome === "yes" ? livePrice.yes : livePrice.no;

      // Slippage check
      if (estimatedPrice > 1 - config.maxSlippage) {
        log.info("tick:slippage-too-high", {
          marketId: pos.marketId,
          price: estimatedPrice,
          maxSlippage: config.maxSlippage,
        });
        continue;
      }

      // Risk check
      const riskCheck = await risk.checkTrade({
        botInstanceId: config.dbBotId,
        size: copySize,
        price: estimatedPrice,
      });

      if (!riskCheck.allowed) {
        log.info("tick:risk-blocked", {
          traderId,
          marketId: pos.marketId,
          reason: riskCheck.reason,
        });
        continue;
      }

      const finalSize = riskCheck.suggestedSize ?? copySize;

      log.info("tick:copying-trade", {
        traderId,
        marketId: pos.marketId,
        outcome: pos.outcome,
        originalSize: sizeDelta,
        copySize: finalSize,
      });

      // Execute trade on exchange
      const orderResult = await client.placeOrder({
        marketId: pos.marketId,
        side: "buy",
        outcome: pos.outcome as "yes" | "no",
        price: estimatedPrice,
        size: finalSize,
      });

      if (orderResult.status === "failed") {
        log.error("tick:order-failed", {
          marketId: pos.marketId,
          orderId: orderResult.orderId,
        });
        continue;
      }

      // Get market info for DB upsert
      const marketInfo = await client.getMarket(pos.marketId).catch(() => null);
      const dbMarketId = await ensureMarket(db, {
        platformId: pos.marketId,
        platform: config.platform,
        title: marketInfo?.title ?? pos.marketId,
        status: "active",
      });

      // Record the trade
      await (bot as any).recordTrade({
        marketId: dbMarketId,
        platform: config.platform,
        side: "buy",
        outcome: pos.outcome as "yes" | "no",
        price: orderResult.filledPrice ?? estimatedPrice,
        size: orderResult.filledSize ?? finalSize,
        reason: `copy:${traderId}:${pos.marketId}`,
      } satisfies TradeRecord);

      // Discord notification (fire-and-forget)
      if (env.DISCORD_WEBHOOK_URL) {
        const cashBalance = await client.getBalance().catch(() => 0);
        const summary = await buildPortfolioSummary(
          db,
          config.dbBotId,
          cashBalance
        );
        await notifyDiscord(env.DISCORD_WEBHOOK_URL as string, {
          tradeType: "COPY_BUY",
          marketName: marketInfo?.title ?? pos.marketId,
          outcome: pos.outcome as "yes" | "no",
          price: orderResult.filledPrice ?? estimatedPrice,
          shares: orderResult.filledSize ?? finalSize,
          cost:
            (orderResult.filledPrice ?? estimatedPrice) *
            (orderResult.filledSize ?? finalSize),
          fee: 0,
          pnl: undefined,
          traderAddress: traderId,
          timestamp: new Date().toISOString(),
          portfolioSummary: summary,
        });
      }
    } else if (sizeDelta < 0 && config.copySells) {
      // Position decreased — copy the sell
      const sellSize = Math.min(
        Math.abs(sizeDelta) * config.sizeFraction,
        config.maxPositionSize
      );

      if (sellSize < 1) continue;

      const livePrice = await client.getPrice(pos.marketId).catch(() => null);
      if (!livePrice) continue;

      const sellPrice =
        pos.outcome === "yes" ? livePrice.yes : livePrice.no;

      log.info("tick:copying-sell", {
        traderId,
        marketId: pos.marketId,
        outcome: pos.outcome,
        sellSize,
      });

      const orderResult = await client.placeOrder({
        marketId: pos.marketId,
        side: "sell",
        outcome: pos.outcome as "yes" | "no",
        price: sellPrice,
        size: sellSize,
      });

      if (orderResult.status === "failed") {
        log.error("tick:sell-order-failed", {
          marketId: pos.marketId,
          orderId: orderResult.orderId,
        });
        continue;
      }

      const dbMarketId = await ensureMarket(db, {
        platformId: pos.marketId,
        platform: config.platform,
        title: pos.marketId,
        status: "active",
      });

      await (bot as any).recordTrade({
        marketId: dbMarketId,
        platform: config.platform,
        side: "sell",
        outcome: pos.outcome as "yes" | "no",
        price: orderResult.filledPrice ?? sellPrice,
        size: orderResult.filledSize ?? sellSize,
        reason: `copy-sell:${traderId}:${pos.marketId}`,
      } satisfies TradeRecord);

      // Discord notification (fire-and-forget)
      if (env.DISCORD_WEBHOOK_URL) {
        const cashBalance = await client.getBalance().catch(() => 0);
        const summary = await buildPortfolioSummary(
          db,
          config.dbBotId,
          cashBalance
        );
        await notifyDiscord(env.DISCORD_WEBHOOK_URL as string, {
          tradeType: "COPY_SELL",
          marketName: pos.marketId,
          outcome: pos.outcome as "yes" | "no",
          price: orderResult.filledPrice ?? sellPrice,
          shares: orderResult.filledSize ?? sellSize,
          cost:
            (orderResult.filledPrice ?? sellPrice) *
            (orderResult.filledSize ?? sellSize),
          fee: 0,
          pnl: undefined,
          traderAddress: traderId,
          timestamp: new Date().toISOString(),
          portfolioSummary: summary,
        });
      }
    }
  }

  // Update cache
  lastSeenPositions.set(traderId, currentPositions);
}

/**
 * Fetch a trader's current positions from the exchange.
 * Platform-specific implementation.
 */
async function fetchTraderPositions(
  platform: string,
  traderId: string
): Promise<Array<{ marketId: string; outcome: string; size: number }>> {
  if (platform === "polymarket") {
    // Polymarket Data API is public — no auth needed
    const res = await fetch(
      `https://data-api.polymarket.com/positions?user=${traderId}`
    );
    if (!res.ok) {
      throw new Error(`Data API ${res.status}: ${await res.text()}`);
    }
    const data: any[] = await res.json();
    return data.map((p) => ({
      marketId: p.asset?.condition_id ?? p.conditionId ?? "",
      outcome: (p.outcome ?? "yes").toLowerCase(),
      size: Number(p.size ?? 0),
    }));
  }

  // Kalshi doesn't expose other traders' positions publicly
  return [];
}
