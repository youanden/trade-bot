import { createDb } from "../../core/db/client";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import type { ExchangeClient, MarketInfo } from "../../core/exchanges/types";
import type { BaseBotDO } from "../base";
import type { LlmPickerConfig } from "./config";
import { Logger } from "../../core/utils/logger";
import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";
import { generateText } from "ai";

const log = new Logger({ strategy: "llm-picker" });

interface PickerResponse {
  pick: "yes" | "no";
  confidence: number;
  reasoning: string;
}

/**
 * LLM picker strategy.
 *
 * Uses Workers AI with a configurable prompt template to pick YES or NO
 * for prediction markets, then places a trade when confidence is sufficient.
 */
export async function llmPickerTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as LlmPickerConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("llm-picker"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  if (!env.CF_AIG_TOKEN) {
    log.error("tick:no-aig-token", {
      hint: "Set CF_AIG_TOKEN secret for Cloudflare AI Gateway",
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

  // Resolve markets: use configured IDs or discover active markets
  let marketsToEvaluate: MarketInfo[];

  if (config.marketIds?.length) {
    const resolved: MarketInfo[] = [];
    for (const platformId of config.marketIds) {
      try {
        const { markets } = await client.getMarkets({ limit: 1, status: "active" });
        const match = markets.find((m) => m.platformId === platformId);
        if (match) resolved.push(match);
      } catch (err) {
        log.error("tick:resolve-market-failed", {
          platformId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    marketsToEvaluate = resolved;
  } else {
    const { markets: activeMarkets } = await client.getMarkets({
      limit: config.maxMarkets ?? 5,
      status: "active",
    });
    marketsToEvaluate = activeMarkets.slice(0, config.maxMarkets ?? 5);
  }

  for (const market of marketsToEvaluate) {
    try {
      await evaluateMarket(bot, env, client, db, config, risk, market);
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
  config: LlmPickerConfig,
  risk: PortfolioRisk,
  market: MarketInfo
): Promise<void> {
  const price = await client.getPrice(market.platformId);

  // Interpolate prompt template with market data
  const interpolatedPrompt = interpolatePrompt(config.promptTemplate, {
    title: market.title,
    description: market.description ?? "",
    yesPrice: price.yes,
    noPrice: price.no,
    category: market.category ?? "",
    endDate: market.endDate ?? "",
  });

  // Call AI via AI Gateway
  const aigateway = createAiGateway({
    accountId: "2883160c80d41a3c439a131bf0378c6d",
    gateway: "default",
    apiKey: env.CF_AIG_TOKEN ?? "",
  });
  const unified = createUnified();
  const { text: responseText } = await generateText({
    model: aigateway(unified(`workers-ai/${config.aiModel}`)),
    messages: [
      {
        role: "system",
        content:
          "You are a prediction market analyst. Respond with ONLY valid JSON.",
      },
      { role: "user", content: interpolatedPrompt },
    ],
  });

  const parsed = parsePickerResponse(responseText);

  if (!parsed) {
    log.debug("tick:parse-failed", {
      market: market.title,
      response: responseText.slice(0, 200),
    });
    return;
  }

  const { pick, confidence, reasoning } = parsed;

  log.debug("tick:picked", {
    market: market.title,
    pick,
    confidence,
    reasoning: reasoning.slice(0, 100),
  });

  // Only trade with sufficient confidence
  if (confidence < 0.5) {
    log.debug("tick:low-confidence", { market: market.title, confidence });
    return;
  }

  const tradePrice = pick === "yes" ? price.yes : price.no;

  const riskCheck = await risk.checkTrade({
    botInstanceId: config.dbBotId,
    size: config.maxPositionSize,
    price: tradePrice,
  });

  if (!riskCheck.allowed) {
    log.info("tick:risk-blocked", { reason: riskCheck.reason });
    return;
  }

  const finalSize = Math.min(
    config.maxPositionSize,
    riskCheck.suggestedSize ?? config.maxPositionSize
  );
  if (finalSize < 1) return;

  log.info("tick:trading", {
    market: market.title,
    pick,
    confidence,
    size: finalSize,
  });

  const orderResult = await client.placeOrder({
    marketId: market.platformId,
    side: "buy",
    outcome: pick,
    price: tradePrice,
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
    outcome: pick,
    price: orderResult.filledPrice ?? tradePrice,
    size: orderResult.filledSize ?? finalSize,
    reason: `llm-picker:pick=${pick}:conf=${confidence.toFixed(2)}`,
  });
}

/**
 * Interpolate a prompt template with market variable values.
 * Replaces {{title}}, {{description}}, {{yesPrice}}, {{noPrice}}, {{category}}, {{endDate}}.
 *
 * @param template - Prompt template string with {{placeholder}} syntax
 * @param vars - Market variable values
 */
export function interpolatePrompt(
  template: string,
  vars: {
    title: string;
    description: string;
    yesPrice: number;
    noPrice: number;
    category: string;
    endDate: string;
  }
): string {
  return template
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{description\}\}/g, vars.description)
    .replace(/\{\{yesPrice\}\}/g, (vars.yesPrice * 100).toFixed(1))
    .replace(/\{\{noPrice\}\}/g, (vars.noPrice * 100).toFixed(1))
    .replace(/\{\{category\}\}/g, vars.category)
    .replace(/\{\{endDate\}\}/g, vars.endDate);
}

/**
 * Parse LLM response for a picker decision.
 * Expected format: {"pick": "yes"|"no", "confidence": 0.0-1.0, "reasoning": "..."}
 */
export function parsePickerResponse(response: string): PickerResponse | null {
  // Try to extract JSON object from response
  try {
    const jsonMatch = response.match(/\{[\s\S]*"pick"[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      const pick = String(obj.pick).toLowerCase();
      if (pick !== "yes" && pick !== "no") return null;
      const confidence = Number(obj.confidence);
      if (isNaN(confidence) || confidence < 0 || confidence > 1) return null;
      return {
        pick: pick as "yes" | "no",
        confidence,
        reasoning: String(obj.reasoning ?? ""),
      };
    }
  } catch {}

  return null;
}
