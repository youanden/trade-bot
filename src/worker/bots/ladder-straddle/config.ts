import type { BotConfig } from "../base";

export interface LadderStraddleConfig extends BotConfig {
  botType: "ladder-straddle";
  /** Platform to trade on */
  platform: "polymarket" | "kalshi";
  /** Market to straddle */
  marketId: string;
  /** Price levels for the ladder (e.g. [0.30, 0.40, 0.50, 0.60, 0.70]) */
  priceLevels: number[];
  /** Size per level */
  sizePerLevel: number;
  /** Take profit per contract (e.g. 0.10 = 10 cents) */
  takeProfit: number;
}

export const DEFAULT_LADDER_STRADDLE_CONFIG: Partial<LadderStraddleConfig> = {
  botType: "ladder-straddle",
  tickIntervalMs: 60_000,
  platform: "polymarket",
  priceLevels: [0.3, 0.4, 0.5, 0.6, 0.7],
  sizePerLevel: 50,
  takeProfit: 0.1,
};
