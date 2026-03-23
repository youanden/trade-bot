import { createDb } from "../../core/db/client";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import type { MarketInfo } from "../../core/exchanges/types";
import type { BaseBotDO } from "../base";
import type { LogicalArbConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "logical-arb" });

/**
 * Logical arbitrage strategy.
 *
 * Detects pricing violations in binary markets:
 * - YES + NO should sum to ~1.00
 * - If sum > 1.0 + threshold → sell both sides (guaranteed profit)
 * - If sum < 1.0 - threshold → buy both sides (guaranteed profit)
 */
export async function logicalArbTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as LogicalArbConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("logical-arb"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  let client;
  try {
    client = createExchangeClient(env, config.platform);
  } catch (err) {
    log.error("tick:client-init-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  log.debug("tick:scanning", { platform: config.platform });

  // Fetch active markets
  const { markets: activeMarkets } = await client.getMarkets({
    limit: 100,
    status: "active",
  });

  for (const market of activeMarkets) {
    try {
      const price = await client.getPrice(market.platformId);
      const sum = price.yes + price.no;
      const deviation = sum - 1.0;

      if (Math.abs(deviation) <= config.violationThreshold) continue;

      log.info("tick:violation-detected", {
        market: market.title,
        yesPrice: price.yes,
        noPrice: price.no,
        sum,
        deviation,
      });

      // Calculate arb edge (guaranteed profit per unit)
      const edge = Math.abs(deviation);
      const tradeSize = Math.min(
        config.maxPositionSize,
        Math.floor(edge * 1000) // scale by edge size
      );

      if (tradeSize < 1) continue;

      const riskCheck = await risk.checkTrade({
        botInstanceId: config.dbBotId,
        size: tradeSize,
        price: Math.max(price.yes, price.no),
      });

      if (!riskCheck.allowed) {
        log.info("tick:risk-blocked", { reason: riskCheck.reason });
        continue;
      }

      const finalSize = riskCheck.suggestedSize ?? tradeSize;

      const dbMarketId = await ensureMarket(db, market);

      if (deviation > 0) {
        // Sum > 1: overpriced — sell both sides
        // In prediction markets, "selling" = buying the opposite
        // or placing sell orders if supported
        log.info("tick:arb-sell-both", {
          market: market.title,
          sum,
          size: finalSize,
        });

        // Sell YES (or buy NO at discount)
        const sellYes = await client.placeOrder({
          marketId: market.platformId,
          side: "sell",
          outcome: "yes",
          price: price.yes,
          size: finalSize,
        });

        // Sell NO (or buy YES at discount)
        const sellNo = await client.placeOrder({
          marketId: market.platformId,
          side: "sell",
          outcome: "no",
          price: price.no,
          size: finalSize,
        });

        if (sellYes.status !== "failed") {
          await (bot as any).recordTrade({
            marketId: dbMarketId,
            platform: config.platform,
            side: "sell",
            outcome: "yes",
            price: sellYes.filledPrice ?? price.yes,
            size: sellYes.filledSize ?? finalSize,
            reason: `logical-arb:sell-yes:sum=${sum.toFixed(3)}`,
          });
        }

        if (sellNo.status !== "failed") {
          await (bot as any).recordTrade({
            marketId: dbMarketId,
            platform: config.platform,
            side: "sell",
            outcome: "no",
            price: sellNo.filledPrice ?? price.no,
            size: sellNo.filledSize ?? finalSize,
            reason: `logical-arb:sell-no:sum=${sum.toFixed(3)}`,
          });
        }
      } else {
        // Sum < 1: underpriced — buy both sides
        log.info("tick:arb-buy-both", {
          market: market.title,
          sum,
          size: finalSize,
        });

        const buyYes = await client.placeOrder({
          marketId: market.platformId,
          side: "buy",
          outcome: "yes",
          price: price.yes,
          size: finalSize,
        });

        const buyNo = await client.placeOrder({
          marketId: market.platformId,
          side: "buy",
          outcome: "no",
          price: price.no,
          size: finalSize,
        });

        if (buyYes.status !== "failed") {
          await (bot as any).recordTrade({
            marketId: dbMarketId,
            platform: config.platform,
            side: "buy",
            outcome: "yes",
            price: buyYes.filledPrice ?? price.yes,
            size: buyYes.filledSize ?? finalSize,
            reason: `logical-arb:buy-yes:sum=${sum.toFixed(3)}`,
          });
        }

        if (buyNo.status !== "failed") {
          await (bot as any).recordTrade({
            marketId: dbMarketId,
            platform: config.platform,
            side: "buy",
            outcome: "no",
            price: buyNo.filledPrice ?? price.no,
            size: buyNo.filledSize ?? finalSize,
            reason: `logical-arb:buy-no:sum=${sum.toFixed(3)}`,
          });
        }
      }
    } catch (err) {
      log.error("tick:market-error", {
        market: market.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
