import type { BotConfig } from "../base";

export interface CrossArbConfig extends BotConfig {
  botType: "cross-arb";
  /** Minimum price spread to trigger (e.g. 0.05 = 5 cents) */
  minSpread: number;
  /** Max position size per arb trade */
  maxPositionSize: number;
  /** Platforms to arb between */
  platforms: ("polymarket" | "kalshi")[];
}

export const DEFAULT_CROSS_ARB_CONFIG: Partial<CrossArbConfig> = {
  botType: "cross-arb",
  tickIntervalMs: 15_000,
  minSpread: 0.05,
  maxPositionSize: 500,
  platforms: ["polymarket", "kalshi"],
};
