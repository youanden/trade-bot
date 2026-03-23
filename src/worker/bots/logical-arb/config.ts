import type { BotConfig } from "../base";

export interface LogicalArbConfig extends BotConfig {
  botType: "logical-arb";
  /** Platform to monitor */
  platform: "polymarket" | "kalshi";
  /** Min pricing violation to trigger (sum > 1.0 + threshold) */
  violationThreshold: number;
  /** Max position size */
  maxPositionSize: number;
}

export const DEFAULT_LOGICAL_ARB_CONFIG: Partial<LogicalArbConfig> = {
  botType: "logical-arb",
  tickIntervalMs: 30_000,
  platform: "polymarket",
  violationThreshold: 0.03,
  maxPositionSize: 300,
};
