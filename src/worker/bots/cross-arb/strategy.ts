import { createDb } from "../../core/db/client";
import { markets, marketLinks } from "../../core/db/schema";
import { eq } from "drizzle-orm";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import type { BaseBotDO } from "../base";
import type { CrossArbConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "cross-arb" });

/**
 * Cross-platform arbitrage strategy.
 *
 * Detects price discrepancies between Polymarket and Kalshi
 * for the same event (linked via market_links table).
 * Buys on the cheaper exchange, sells/buys-NO on the expensive one.
 */
export async function crossArbTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as CrossArbConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("cross-arb"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  // Create exchange clients for both platforms
  const clients = new Map<string, ReturnType<typeof createExchangeClient>>();
  for (const platform of config.platforms) {
    try {
      clients.set(platform, createExchangeClient(env, platform));
    } catch (err) {
      log.error("tick:client-init-failed", {
        platform,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (clients.size < 2) {
    log.warn("tick:need-two-platforms", { available: Array.from(clients.keys()) });
    return;
  }

  // Get all linked market pairs
  const links = await db.select().from(marketLinks);

  for (const link of links) {
    try {
      // Fetch both markets from DB
      const [marketA] = await db
        .select()
        .from(markets)
        .where(eq(markets.id, link.marketIdA));
      const [marketB] = await db
        .select()
        .from(markets)
        .where(eq(markets.id, link.marketIdB));

      if (!marketA || !marketB) continue;
      if (marketA.status !== "active" || marketB.status !== "active") continue;

      const clientA = clients.get(marketA.platform);
      const clientB = clients.get(marketB.platform);
      if (!clientA || !clientB) continue;

      // Fetch live prices from both exchanges
      const [priceA, priceB] = await Promise.all([
        clientA.getPrice(marketA.platformId).catch(() => null),
        clientB.getPrice(marketB.platformId).catch(() => null),
      ]);

      if (!priceA || !priceB) continue;

      const spread = Math.abs(priceA.yes - priceB.yes);

      log.debug("tick:checking-pair", {
        marketA: marketA.title,
        marketB: marketB.title,
        priceA: priceA.yes,
        priceB: priceB.yes,
        spread,
      });

      if (spread < config.minSpread) continue;

      // Determine direction: buy YES on cheaper, buy NO on expensive
      const cheapSide = priceA.yes < priceB.yes ? "A" : "B";
      const cheapClient = cheapSide === "A" ? clientA : clientB;
      const expensiveClient = cheapSide === "A" ? clientB : clientA;
      const cheapMarket = cheapSide === "A" ? marketA : marketB;
      const expensiveMarket = cheapSide === "A" ? marketB : marketA;
      const cheapPrice = cheapSide === "A" ? priceA.yes : priceB.yes;
      const expensivePrice = cheapSide === "A" ? priceB.yes : priceA.yes;

      const tradeSize = Math.min(config.maxPositionSize, 50); // conservative default

      // Risk check
      const riskCheck = await risk.checkTrade({
        botInstanceId: config.dbBotId,
        size: tradeSize,
        price: cheapPrice,
      });

      if (!riskCheck.allowed) {
        log.info("tick:risk-blocked", { reason: riskCheck.reason });
        continue;
      }

      const finalSize = riskCheck.suggestedSize ?? tradeSize;

      // Execute both legs
      log.info("tick:executing-arb", {
        spread,
        cheapPlatform: cheapMarket.platform,
        expensivePlatform: expensiveMarket.platform,
        size: finalSize,
      });

      // Leg 1: Buy YES on cheaper exchange
      const buyResult = await cheapClient.placeOrder({
        marketId: cheapMarket.platformId,
        side: "buy",
        outcome: "yes",
        price: cheapPrice,
        size: finalSize,
      });

      if (buyResult.status === "failed") {
        log.error("tick:buy-leg-failed", { orderId: buyResult.orderId });
        continue;
      }

      // Leg 2: Buy NO on expensive exchange (equivalent to selling YES)
      const sellResult = await expensiveClient.placeOrder({
        marketId: expensiveMarket.platformId,
        side: "buy",
        outcome: "no",
        price: 1 - expensivePrice,
        size: finalSize,
      });

      if (sellResult.status === "failed") {
        log.error("tick:sell-leg-failed", { orderId: sellResult.orderId });
        // Note: buy leg already placed — partial fill risk
      }

      // Record both legs
      const cheapDbId = await ensureMarket(db, {
        platformId: cheapMarket.platformId,
        platform: cheapMarket.platform as "polymarket" | "kalshi",
        title: cheapMarket.title,
        status: "active",
      });

      const expensiveDbId = await ensureMarket(db, {
        platformId: expensiveMarket.platformId,
        platform: expensiveMarket.platform as "polymarket" | "kalshi",
        title: expensiveMarket.title,
        status: "active",
      });

      await (bot as any).recordTrade({
        marketId: cheapDbId,
        platform: cheapMarket.platform,
        side: "buy",
        outcome: "yes",
        price: buyResult.filledPrice ?? cheapPrice,
        size: buyResult.filledSize ?? finalSize,
        reason: `cross-arb:buy-yes:spread=${spread.toFixed(3)}`,
      });

      await (bot as any).recordTrade({
        marketId: expensiveDbId,
        platform: expensiveMarket.platform,
        side: "buy",
        outcome: "no",
        price: sellResult.filledPrice ?? (1 - expensivePrice),
        size: sellResult.filledSize ?? finalSize,
        reason: `cross-arb:buy-no:spread=${spread.toFixed(3)}`,
      });

      log.info("tick:arb-executed", { spread, size: finalSize });
    } catch (err) {
      log.error("tick:pair-error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
