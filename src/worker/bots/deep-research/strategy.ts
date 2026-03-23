import { createDb } from "../../core/db/client";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import { kellySize, kellySizeNo } from "../../core/risk/kelly";
import type { ExchangeClient, MarketInfo } from "../../core/exchanges/types";
import type { BaseBotDO } from "../base";
import type { DeepResearchConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "deep-research" });

/**
 * Deep research strategy.
 *
 * Multi-step LLM reasoning for probability estimation:
 * 1. Initial assessment
 * 2. Self-critique and counter-arguments
 * 3. Final calibrated estimate
 *
 * Higher conviction than llm-assessor, slower cadence, larger positions.
 */
export async function deepResearchTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as DeepResearchConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("deep-research"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  if (!env.AI) {
    log.error("tick:no-ai-binding");
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

  log.debug("tick:deep-research", {
    platform: config.platform,
    categories: config.categories,
  });

  // Fetch markets filtered by categories
  const { markets: activeMarkets } = await client.getMarkets({
    limit: 50,
    status: "active",
  });

  const filteredMarkets = config.categories?.length
    ? activeMarkets.filter(
        (m) =>
          m.category &&
          config.categories.some(
            (c) => m.category!.toLowerCase().includes(c.toLowerCase())
          )
      )
    : activeMarkets;

  // Deep research is slow — limit to top 3 markets per tick
  const marketsToResearch = filteredMarkets.slice(0, 3);
  const balance = await client.getBalance();

  for (const market of marketsToResearch) {
    try {
      await researchAndTrade(
        bot,
        env,
        client,
        db,
        config,
        risk,
        market,
        balance
      );
    } catch (err) {
      log.error("tick:research-error", {
        market: market.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function researchAndTrade(
  bot: BaseBotDO,
  env: Env,
  client: ExchangeClient,
  db: ReturnType<typeof createDb>,
  config: DeepResearchConfig,
  risk: PortfolioRisk,
  market: MarketInfo,
  balance: number
): Promise<void> {
  const price = await client.getPrice(market.platformId);

  // Step 1: Initial assessment
  const initialPrompt = `You are an expert analyst. Assess the probability of this prediction market resolving YES.

Market: ${market.title}
${market.description ? `Description: ${market.description}` : ""}
${market.category ? `Category: ${market.category}` : ""}
${market.endDate ? `End Date: ${market.endDate}` : ""}
Current Market Price: ${(price.yes * 100).toFixed(1)}%

Provide a detailed analysis considering:
- Historical precedent and base rates
- Current conditions and trends
- Key factors that could influence the outcome
- Uncertainty and known unknowns

Respond with JSON: {"probability": 0.XX, "analysis": "detailed reasoning", "confidence": "low|medium|high"}`;

  const step1: any = await env.AI!.run(config.aiModel as any, {
    messages: [
      {
        role: "system",
        content:
          "You are a rigorous probability analyst. Always respond with JSON containing probability, analysis, and confidence fields.",
      },
      { role: "user", content: initialPrompt },
    ],
  });

  const step1Text =
    typeof step1 === "string"
      ? step1
      : step1?.response ?? step1?.result ?? "";

  const initialProb = parseProbability(step1Text);
  if (initialProb === null) {
    log.debug("tick:step1-parse-failed", { market: market.title });
    return;
  }

  // Step 2: Self-critique
  const critiquePrompt = `You previously estimated a ${(initialProb * 100).toFixed(1)}% probability for this market:

"${market.title}"

Your analysis: ${step1Text.slice(0, 500)}

Now critically evaluate your estimate:
1. What are the strongest counter-arguments?
2. What biases might affect your judgment?
3. Are there information gaps you're filling with assumptions?
4. How would you adjust your probability accounting for these critiques?

Respond with JSON: {"adjusted_probability": 0.XX, "critique": "key counter-arguments", "calibration_note": "adjustment reasoning"}`;

  const step2: any = await env.AI!.run(config.aiModel as any, {
    messages: [
      {
        role: "system",
        content:
          "You are a critical thinker reviewing probability estimates. Be contrarian and rigorous. Respond with JSON.",
      },
      { role: "user", content: critiquePrompt },
    ],
  });

  const step2Text =
    typeof step2 === "string"
      ? step2
      : step2?.response ?? step2?.result ?? "";

  // Step 3: Final calibrated estimate
  const finalPrompt = `Based on both analyses, provide your final calibrated probability for:

"${market.title}"

Initial estimate: ${(initialProb * 100).toFixed(1)}%
Critique: ${step2Text.slice(0, 500)}

Give your FINAL calibrated probability. Weight the critique appropriately.
Respond with ONLY JSON: {"final_probability": 0.XX, "conviction": "low|medium|high"}`;

  const step3: any = await env.AI!.run(config.aiModel as any, {
    messages: [
      {
        role: "system",
        content:
          "You are calibrating a final probability estimate. Respond with JSON only.",
      },
      { role: "user", content: finalPrompt },
    ],
  });

  const step3Text =
    typeof step3 === "string"
      ? step3
      : step3?.response ?? step3?.result ?? "";

  const finalProb = parseProbability(step3Text) ?? initialProb;
  const edge = Math.abs(finalProb - price.yes);

  log.info("tick:research-complete", {
    market: market.title,
    initialProb,
    finalProb,
    marketPrice: price.yes,
    edge,
  });

  if (edge < config.minEdge) return;

  // Larger conviction sizing than llm-assessor
  const shouldBuyYes = finalProb > price.yes;
  const sizing = shouldBuyYes
    ? kellySize({
        probability: finalProb,
        odds: price.yes,
        bankroll: balance,
        fraction: 0.2, // More aggressive than llm-assessor (multi-step reasoning)
      })
    : kellySizeNo({
        probability: finalProb,
        odds: price.yes,
        bankroll: balance,
        fraction: 0.2,
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
    finalProb,
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
    reason: `deep-research:edge=${edge.toFixed(3)}:prob=${finalProb.toFixed(3)}:market=${price.yes.toFixed(3)}`,
  });
}

function parseProbability(response: string): number | null {
  // Try structured JSON fields
  for (const field of [
    "final_probability",
    "adjusted_probability",
    "probability",
  ]) {
    const match = response.match(
      new RegExp(`"${field}"\\s*:\\s*(\\d*\\.?\\d+)`)
    );
    if (match) {
      const prob = parseFloat(match[1]);
      if (prob >= 0 && prob <= 1) return prob;
    }
  }

  // Fallback: decimal between 0 and 1
  const numMatch = response.match(/\b0\.\d+\b/);
  if (numMatch) {
    const prob = parseFloat(numMatch[0]);
    if (prob >= 0 && prob <= 1) return prob;
  }

  // Fallback: percentage
  const pctMatch = response.match(/(\d{1,3})%/);
  if (pctMatch) {
    const prob = parseInt(pctMatch[1], 10) / 100;
    if (prob >= 0 && prob <= 1) return prob;
  }

  return null;
}
