import { createDb } from "../../core/db/client";
import { orders } from "../../core/db/schema";
import { eq, and } from "drizzle-orm";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import type { ExchangeClient } from "../../core/exchanges/types";
import type { BaseBotDO } from "../base";
import type { MarketMakerConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "market-maker" });

// Track our open order IDs per market (DO-scoped)
const activeOrders = new Map<string, string[]>();

/**
 * Market maker strategy.
 *
 * Maintains bid-ask spread around fair value, earning the spread.
 * Manages inventory to stay delta-neutral.
 */
export async function marketMakerTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as MarketMakerConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("market-maker"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  let client: ExchangeClient;
  try {
    client = createExchangeClient(env, config.platform);
  } catch (err) {
    log.error("tick:client-init-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Resolve market IDs: use configured list or discover dynamically
  let marketIds = config.marketIds ?? [];

  if (marketIds.length === 0) {
    log.info("tick:discovering-markets");
    try {
      const { markets } = await client.getMarkets({ limit: 100, status: "active" });
      const minVolume = config.minVolume ?? 0;
      const maxMarkets = config.maxMarkets ?? 5;

      marketIds = markets
        .filter((m) => (m.volume ?? 0) >= minVolume)
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
        .slice(0, maxMarkets)
        .map((m) => m.platformId);

      log.info("tick:discovered-markets", { count: marketIds.length, marketIds });
    } catch (err) {
      log.error("tick:discovery-failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  if (marketIds.length === 0) {
    log.info("tick:no-markets-available");
    return;
  }

  for (const marketId of marketIds) {
    try {
      await makeMarket(bot, client, db, config, risk, marketId);
    } catch (err) {
      log.error("tick:market-error", {
        marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function makeMarket(
  bot: BaseBotDO,
  client: ExchangeClient,
  db: ReturnType<typeof createDb>,
  config: MarketMakerConfig,
  risk: PortfolioRisk,
  marketId: string
): Promise<void> {
  // 1. Get order book and calculate midpoint
  const orderBook = await client.getOrderBook(marketId);
  const bestBid = orderBook.bids[0]?.price ?? 0;
  const bestAsk = orderBook.asks[0]?.price ?? 1;
  const mid = (bestBid + bestAsk) / 2;

  if (mid <= 0 || mid >= 1) {
    log.debug("tick:invalid-mid", { marketId, mid });
    return;
  }

  log.debug("tick:market-state", {
    marketId,
    bestBid,
    bestAsk,
    mid,
    currentSpread: bestAsk - bestBid,
  });

  // 2. Cancel stale orders
  const prevOrderIds = activeOrders.get(marketId) ?? [];
  for (const orderId of prevOrderIds) {
    try {
      await client.cancelOrder(orderId);
    } catch {
      // Order may already be filled or cancelled
    }
  }

  // 3. Check for fills from previous tick by querying current open orders
  const openOrders = await client.getOpenOrders(marketId);
  const filledOrders = prevOrderIds.filter(
    (id) => !openOrders.some((o) => o.orderId === id)
  );

  if (filledOrders.length > 0) {
    log.info("tick:orders-filled", {
      marketId,
      filledCount: filledOrders.length,
    });
  }

  // 4. Check inventory and calculate skew
  const positions = await client.getPositions();
  const marketPositions = positions.filter((p) => p.marketId === marketId);
  const yesInventory = marketPositions
    .filter((p) => p.outcome === "yes")
    .reduce((sum, p) => sum + p.size, 0);
  const noInventory = marketPositions
    .filter((p) => p.outcome === "no")
    .reduce((sum, p) => sum + p.size, 0);
  const netInventory = yesInventory - noInventory;

  // Skew quotes to reduce inventory
  const inventorySkew =
    Math.abs(netInventory) > config.maxInventory
      ? (netInventory / config.maxInventory) * config.spreadWidth * 0.5
      : 0;

  // 5. Place bid/ask ladder
  const halfSpread = config.spreadWidth / 2;
  const newOrderIds: string[] = [];

  const marketInfo = await client.getMarket(marketId).catch(() => null);
  const dbMarketId = await ensureMarket(db, {
    platformId: marketId,
    platform: config.platform,
    title: marketInfo?.title ?? marketId,
    status: "active",
  });

  for (let level = 0; level < config.levels; level++) {
    const levelOffset = level * config.spreadWidth * 0.5;

    // Bid (buy YES)
    const bidPrice = Math.max(
      0.01,
      Math.min(0.99, mid - halfSpread - levelOffset - inventorySkew)
    );
    const bidPrice2 = Math.round(bidPrice * 100) / 100;

    // Ask (sell YES / buy NO)
    const askPrice = Math.max(
      0.01,
      Math.min(0.99, mid + halfSpread + levelOffset - inventorySkew)
    );
    const askPrice2 = Math.round(askPrice * 100) / 100;

    // Risk check for each level
    const riskCheck = await risk.checkTrade({
      botInstanceId: config.dbBotId,
      size: config.orderSize,
      price: bidPrice2,
    });

    if (!riskCheck.allowed) {
      log.debug("tick:risk-blocked-level", { level, reason: riskCheck.reason });
      break;
    }

    // Place bid
    const bidResult = await client.placeOrder({
      marketId,
      side: "buy",
      outcome: "yes",
      price: bidPrice2,
      size: config.orderSize,
      postOnly: true,
    });

    if (bidResult.status !== "failed") {
      newOrderIds.push(bidResult.orderId);
    }

    // Place ask (buy NO at complement price)
    const askResult = await client.placeOrder({
      marketId,
      side: "buy",
      outcome: "no",
      price: Math.round((1 - askPrice2) * 100) / 100,
      size: config.orderSize,
      postOnly: true,
    });

    if (askResult.status !== "failed") {
      newOrderIds.push(askResult.orderId);
    }

    log.debug("tick:level-placed", {
      level,
      bidPrice: bidPrice2,
      askPrice: askPrice2,
    });
  }

  activeOrders.set(marketId, newOrderIds);

  log.debug("tick:orders-placed", {
    marketId,
    count: newOrderIds.length,
    mid,
    netInventory,
    inventorySkew,
  });
}
