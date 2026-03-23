/**
 * Strategy registry — maps bot type strings to strategy tick functions.
 */

import type { BaseBotDO } from "./base";
import { copyTraderTick } from "./copy-trader/strategy";
import { crossArbTick } from "./cross-arb/strategy";
import { logicalArbTick } from "./logical-arb/strategy";
import { llmAssessorTick } from "./llm-assessor/strategy";
import { weatherArbTick } from "./weather-arb/strategy";
import { marketMakerTick } from "./market-maker/strategy";
import { ladderStraddleTick } from "./ladder-straddle/strategy";
import { deepResearchTick } from "./deep-research/strategy";

export type StrategyTickFn = (bot: BaseBotDO, env: Env) => Promise<void>;

const strategies = new Map<string, StrategyTickFn>();

// Register all strategies
strategies.set("copy-trader", copyTraderTick);
strategies.set("cross-arb", crossArbTick);
strategies.set("logical-arb", logicalArbTick);
strategies.set("llm-assessor", llmAssessorTick);
strategies.set("weather-arb", weatherArbTick);
strategies.set("market-maker", marketMakerTick);
strategies.set("ladder-straddle", ladderStraddleTick);
strategies.set("deep-research", deepResearchTick);

export function registerStrategy(botType: string, tickFn: StrategyTickFn) {
  strategies.set(botType, tickFn);
}

export function getStrategy(botType: string): StrategyTickFn | undefined {
  return strategies.get(botType);
}

export function listStrategies(): string[] {
  return Array.from(strategies.keys());
}
