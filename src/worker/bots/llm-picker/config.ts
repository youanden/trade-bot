import type { BotConfig } from "../base";

export interface LlmPickerConfig extends BotConfig {
  botType: "llm-picker";
  /** Platform to trade on */
  platform: "polymarket" | "kalshi";
  /** Workers AI model ID */
  aiModel: string;
  /**
   * Prompt template with placeholders:
   * {{title}}, {{description}}, {{yesPrice}}, {{noPrice}}, {{category}}, {{endDate}}
   */
  promptTemplate: string;
  /** Max contracts per trade */
  maxPositionSize: number;
  /** Optional list of specific platform market IDs to evaluate; if empty, discover active markets */
  marketIds?: string[];
  /** Max markets to evaluate per tick */
  maxMarkets?: number;
}

export const DEFAULT_PROMPT_TEMPLATE = `You are a prediction market analyst. Given this market, decide whether to BUY YES or BUY NO.

Market: {{title}}
Description: {{description}}
Category: {{category}}
End Date: {{endDate}}
Current YES Price: {{yesPrice}}%
Current NO Price: {{noPrice}}%

Respond with ONLY a JSON object: {"pick": "yes" | "no", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

export const DEFAULT_LLM_PICKER_CONFIG: Partial<LlmPickerConfig> = {
  botType: "llm-picker",
  tickIntervalMs: 300_000, // 5 min — LLM calls are slow/expensive
  platform: "polymarket",
  aiModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  maxPositionSize: 100,
  maxMarkets: 5,
};
