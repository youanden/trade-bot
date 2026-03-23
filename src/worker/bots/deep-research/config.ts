import type { BotConfig } from "../base";

export interface DeepResearchConfig extends BotConfig {
  botType: "deep-research";
  /** Platform to trade on */
  platform: "polymarket" | "kalshi";
  /** AI model for analysis */
  aiModel: string;
  /** Market categories to research */
  categories: string[];
  /** Min edge to trade */
  minEdge: number;
  maxPositionSize: number;
  /** Whether to use web search for additional context */
  useWebSearch: boolean;
}

export const DEFAULT_DEEP_RESEARCH_CONFIG: Partial<DeepResearchConfig> = {
  botType: "deep-research",
  tickIntervalMs: 3_600_000, // 1 hour — deep analysis is slow
  platform: "polymarket",
  aiModel: "@cf/meta/llama-3-8b-instruct",
  categories: ["politics", "economics", "crypto"],
  minEdge: 0.15,
  maxPositionSize: 300,
  useWebSearch: false,
};
