import { createDb } from "../../core/db/client";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import { kellySize, kellySizeNo } from "../../core/risk/kelly";
import type { ExchangeClient, MarketInfo } from "../../core/exchanges/types";
import type { BaseBotDO } from "../base";
import type { LlmAssessorConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "llm-assessor" });

/**
 * LLM probability assessment strategy.
 *
 * Uses Workers AI to estimate true probability of market outcomes,
 * then trades when the LLM's estimate diverges from market price.
 */
export async function llmAssessorTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as LlmAssessorConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("llm-assessor"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  if (!env.AI) {
    log.error("tick:no-ai-binding", {
      hint: "Add [ai] binding to wrangler.toml",
    });
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

  log.debug("tick:evaluating", {
    platform: config.platform,
    model: config.aiModel,
  });

  // Fetch active markets, optionally filtered by category
  const { markets: activeMarkets } = await client.getMarkets({
    limit: 20,
    status: "active",
  });

  const filteredMarkets = config.categories?.length
    ? activeMarkets.filter(
        (m) =>
          m.category && config.categories!.includes(m.category.toLowerCase())
      )
    : activeMarkets;

  // Limit to avoid excessive AI calls
  const marketsToEvaluate = filteredMarkets.slice(0, 10);

  const balance = await client.getBalance();

  for (const market of marketsToEvaluate) {
    try {
      await evaluateMarket(bot, env, client, db, config, risk, market, balance);
    } catch (err) {
      log.error("tick:eval-error", {
        market: market.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function evaluateMarket(
  bot: BaseBotDO,
  env: Env,
  client: ExchangeClient,
  db: ReturnType<typeof createDb>,
  config: LlmAssessorConfig,
  risk: PortfolioRisk,
  market: MarketInfo,
  balance: number
): Promise<void> {
  const price = await client.getPrice(market.platformId);

  // Build prompt for probability estimation
  const prompt = buildAssessmentPrompt(market, price.yes);

  // Call Workers AI
  const aiResponse: any = await env.AI!.run(config.aiModel as any, {
    messages: [
      {
        role: "system",
        content:
          "You are a probability assessment expert. Respond with ONLY a JSON object containing a 'probability' field (number between 0 and 1) and a brief 'reasoning' field. No other text.",
      },
      { role: "user", content: prompt },
    ],
  });

  const responseText =
    typeof aiResponse === "string"
      ? aiResponse
      : aiResponse?.response ?? aiResponse?.result ?? "";

  // Parse probability from LLM response
  const llmProb = parseProbability(responseText);

  if (llmProb === null) {
    log.debug("tick:parse-failed", {
      market: market.title,
      response: responseText.slice(0, 200),
    });
    return;
  }

  const edge = Math.abs(llmProb - price.yes);

  log.debug("tick:assessed", {
    market: market.title,
    llmProb,
    marketPrice: price.yes,
    edge,
  });

  if (edge < config.minEdge) return;

  // Size with Kelly (very conservative for LLM-based)
  const shouldBuyYes = llmProb > price.yes;

  const sizing = shouldBuyYes
    ? kellySize({
        probability: llmProb,
        odds: price.yes,
        bankroll: balance,
        fraction: 0.1, // Very conservative for LLM
      })
    : kellySizeNo({
        probability: llmProb,
        odds: price.yes,
        bankroll: balance,
        fraction: 0.1,
      });

  if (!sizing.allowed) return;

  const tradeSize = Math.min(
    sizing.suggestedSize ?? 0,
    config.maxPositionSize
  );
  if (tradeSize < 1) return;

  const riskCheck = await risk.checkTrade({
    botInstanceId: config.dbBotId,
    size: tradeSize,
    price: shouldBuyYes ? price.yes : price.no,
  });

  if (!riskCheck.allowed) {
    log.info("tick:risk-blocked", { reason: riskCheck.reason });
    return;
  }

  const finalSize = riskCheck.suggestedSize ?? tradeSize;

  log.info("tick:trading", {
    market: market.title,
    side: shouldBuyYes ? "buy-yes" : "buy-no",
    llmProb,
    marketPrice: price.yes,
    edge,
    size: finalSize,
  });

  const orderResult = await client.placeOrder({
    marketId: market.platformId,
    side: "buy",
    outcome: shouldBuyYes ? "yes" : "no",
    price: shouldBuyYes ? price.yes : price.no,
    size: finalSize,
  });

  if (orderResult.status === "failed") {
    log.error("tick:order-failed", { orderId: orderResult.orderId });
    return;
  }

  const dbMarketId = await ensureMarket(db, market);

  await (bot as any).recordTrade({
    marketId: dbMarketId,
    platform: config.platform,
    side: "buy",
    outcome: shouldBuyYes ? "yes" : "no",
    price: orderResult.filledPrice ?? (shouldBuyYes ? price.yes : price.no),
    size: orderResult.filledSize ?? finalSize,
    reason: `llm-assessor:edge=${edge.toFixed(3)}:llm=${llmProb.toFixed(3)}:market=${price.yes.toFixed(3)}`,
  });
}

function buildAssessmentPrompt(market: MarketInfo, currentPrice: number): string {
  return `Assess the probability of this prediction market resolving YES.

Market: ${market.title}
${market.description ? `Description: ${market.description}` : ""}
${market.category ? `Category: ${market.category}` : ""}
${market.endDate ? `End Date: ${market.endDate}` : ""}
Current Market Price: ${(currentPrice * 100).toFixed(1)}%

Based on your knowledge, what is the true probability this resolves YES?
Respond with JSON: {"probability": 0.XX, "reasoning": "brief explanation"}`;
}

function parseProbability(response: string): number | null {
  // Try JSON parse first
  try {
    const jsonMatch = response.match(/\{[^}]*"probability"\s*:\s*([\d.]+)[^}]*\}/);
    if (jsonMatch) {
      const prob = parseFloat(jsonMatch[1]);
      if (prob >= 0 && prob <= 1) return prob;
    }
  } catch {}

  // Fallback: look for decimal number between 0 and 1
  const numMatch = response.match(/\b0\.\d+\b/);
  if (numMatch) {
    const prob = parseFloat(numMatch[0]);
    if (prob >= 0 && prob <= 1) return prob;
  }

  // Fallback: look for percentage
  const pctMatch = response.match(/(\d{1,3})%/);
  if (pctMatch) {
    const prob = parseInt(pctMatch[1], 10) / 100;
    if (prob >= 0 && prob <= 1) return prob;
  }

  return null;
}
