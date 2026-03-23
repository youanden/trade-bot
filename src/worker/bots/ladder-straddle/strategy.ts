import { createDb } from "../../core/db/client";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import type { ExchangeClient, OrderResult } from "../../core/exchanges/types";
import type { BaseBotDO } from "../base";
import type { LadderStraddleConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "ladder-straddle" });

// Track ladder state per DO instance
interface LadderState {
  centerPrice: number;
  yesOrders: Map<number, string>; // level price → orderId
  noOrders: Map<number, string>; // complement price → orderId
  filledYes: Map<number, number>; // level price → filled size
  filledNo: Map<number, number>; // level price → filled size
}

const ladderState = new Map<string, LadderState>();

/**
 * Ladder straddle strategy.
 *
 * Places a ladder of limit orders on both YES and NO at different price levels.
 * When orders fill on one side, places take-profit on the other.
 * Profits from mean reversion in range-bound markets.
 */
export async function ladderStraddleTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as LadderStraddleConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("ladder-straddle"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  if (!config.marketId) {
    log.info("tick:no-market-configured");
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

  const marketId = config.marketId;

  // Get current price
  const price = await client.getPrice(marketId);
  const currentPrice = price.yes;

  log.debug("tick:current-price", { marketId, currentPrice });

  // Get or initialize ladder state
  let state = ladderState.get(marketId);
  const driftThreshold = 0.15;

  if (!state || Math.abs(currentPrice - state.centerPrice) > driftThreshold) {
    // Initialize or reset ladder — price has drifted too far
    if (state) {
      log.info("tick:resetting-ladder", {
        oldCenter: state.centerPrice,
        newCenter: currentPrice,
        drift: Math.abs(currentPrice - state.centerPrice),
      });

      // Cancel all existing orders
      for (const orderId of state.yesOrders.values()) {
        await client.cancelOrder(orderId).catch(() => {});
      }
      for (const orderId of state.noOrders.values()) {
        await client.cancelOrder(orderId).catch(() => {});
      }
    }

    state = {
      centerPrice: currentPrice,
      yesOrders: new Map(),
      noOrders: new Map(),
      filledYes: new Map(),
      filledNo: new Map(),
    };
    ladderState.set(marketId, state);

    // Place initial ladder
    await placeLadder(bot, client, db, config, risk, state);
    return;
  }

  // Check for fills by querying open orders
  const openOrders = await client.getOpenOrders(marketId);
  const openIds = new Set(openOrders.map((o) => o.orderId));

  const dbMarketId = await ensureMarket(db, {
    platformId: marketId,
    platform: config.platform,
    title: marketId,
    status: "active",
  });

  // Check YES order fills
  for (const [levelPrice, orderId] of state.yesOrders) {
    if (!openIds.has(orderId)) {
      // Order was filled — record trade and place take-profit
      log.info("tick:yes-filled", { levelPrice, orderId });

      state.yesOrders.delete(levelPrice);
      state.filledYes.set(levelPrice, config.sizePerLevel);

      await (bot as any).recordTrade({
        marketId: dbMarketId,
        platform: config.platform,
        side: "buy",
        outcome: "yes",
        price: levelPrice,
        size: config.sizePerLevel,
        reason: `ladder:yes-fill:level=${levelPrice}`,
      });

      // Place take-profit: sell YES at entry + takeProfit
      const tpPrice = Math.min(0.99, levelPrice + config.takeProfit);
      const tpResult = await client.placeOrder({
        marketId,
        side: "sell",
        outcome: "yes",
        price: Math.round(tpPrice * 100) / 100,
        size: config.sizePerLevel,
      });

      if (tpResult.status !== "failed") {
        log.info("tick:take-profit-placed", {
          side: "yes",
          entryPrice: levelPrice,
          tpPrice,
        });
      }
    }
  }

  // Check NO order fills
  for (const [levelPrice, orderId] of state.noOrders) {
    if (!openIds.has(orderId)) {
      log.info("tick:no-filled", { levelPrice, orderId });

      state.noOrders.delete(levelPrice);
      state.filledNo.set(levelPrice, config.sizePerLevel);

      await (bot as any).recordTrade({
        marketId: dbMarketId,
        platform: config.platform,
        side: "buy",
        outcome: "no",
        price: levelPrice,
        size: config.sizePerLevel,
        reason: `ladder:no-fill:level=${levelPrice}`,
      });

      // Place take-profit: sell NO at entry + takeProfit
      const tpPrice = Math.min(0.99, levelPrice + config.takeProfit);
      const tpResult = await client.placeOrder({
        marketId,
        side: "sell",
        outcome: "no",
        price: Math.round(tpPrice * 100) / 100,
        size: config.sizePerLevel,
      });

      if (tpResult.status !== "failed") {
        log.info("tick:take-profit-placed", {
          side: "no",
          entryPrice: levelPrice,
          tpPrice,
        });
      }
    }
  }
}

async function placeLadder(
  bot: BaseBotDO,
  client: ExchangeClient,
  db: ReturnType<typeof createDb>,
  config: LadderStraddleConfig,
  risk: PortfolioRisk,
  state: LadderState
): Promise<void> {
  const levels = config.priceLevels ?? [0.3, 0.4, 0.5, 0.6, 0.7];

  for (const level of levels) {
    const yesPrice = Math.round(level * 100) / 100;
    const noPrice = Math.round((1 - level) * 100) / 100;

    // Risk check
    const riskCheck = await risk.checkTrade({
      botInstanceId: config.dbBotId,
      size: config.sizePerLevel,
      price: yesPrice,
    });

    if (!riskCheck.allowed) {
      log.debug("tick:risk-blocked-level", {
        level,
        reason: riskCheck.reason,
      });
      continue;
    }

    // Place YES buy order at level price
    const yesResult = await client.placeOrder({
      marketId: config.marketId,
      side: "buy",
      outcome: "yes",
      price: yesPrice,
      size: config.sizePerLevel,
    });

    if (yesResult.status !== "failed") {
      state.yesOrders.set(yesPrice, yesResult.orderId);
    }

    // Place NO buy order at complement price
    const noResult = await client.placeOrder({
      marketId: config.marketId,
      side: "buy",
      outcome: "no",
      price: noPrice,
      size: config.sizePerLevel,
    });

    if (noResult.status !== "failed") {
      state.noOrders.set(noPrice, noResult.orderId);
    }

    log.debug("tick:ladder-level-placed", {
      yesPrice,
      noPrice,
      yesOrderId: yesResult.orderId,
      noOrderId: noResult.orderId,
    });
  }

  log.info("tick:ladder-placed", {
    levels: levels.length,
    totalOrders: state.yesOrders.size + state.noOrders.size,
  });
}
