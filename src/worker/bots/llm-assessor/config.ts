import type { BotConfig } from "../base";

export interface LlmAssessorConfig extends BotConfig {
  botType: "llm-assessor";
  /** Platform to trade on */
  platform: "polymarket" | "kalshi";
  /** AI Gateway or Workers AI binding name */
  aiModel: string;
  /** Min edge required to trade (our probability - market price) */
  minEdge: number;
  /** Max position size */
  maxPositionSize: number;
  /** Market categories to evaluate */
  categories?: string[];
}

export const DEFAULT_LLM_ASSESSOR_CONFIG: Partial<LlmAssessorConfig> = {
  botType: "llm-assessor",
  tickIntervalMs: 300_000, // 5 min — LLM calls are slow/expensive
  platform: "polymarket",
  aiModel: "@cf/meta/llama-3-8b-instruct",
  minEdge: 0.1,
  maxPositionSize: 200,
};
