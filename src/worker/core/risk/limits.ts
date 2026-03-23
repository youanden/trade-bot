import type { PositionLimits } from "./types";

/** Default conservative limits for different bot types. */
export const BOT_LIMITS: Record<string, PositionLimits> = {
  "copy-trader": {
    maxPositionSize: 200,
    maxTotalExposure: 2000,
    maxLossPerTrade: 50,
    maxDailyLoss: 200,
    maxOpenPositions: 10,
  },
  "cross-arb": {
    maxPositionSize: 500,
    maxTotalExposure: 5000,
    maxLossPerTrade: 100,
    maxDailyLoss: 300,
    maxOpenPositions: 20,
  },
  "market-maker": {
    maxPositionSize: 1000,
    maxTotalExposure: 10000,
    maxLossPerTrade: 200,
    maxDailyLoss: 500,
    maxOpenPositions: 50,
  },
  default: {
    maxPositionSize: 100,
    maxTotalExposure: 1000,
    maxLossPerTrade: 25,
    maxDailyLoss: 100,
    maxOpenPositions: 5,
  },
};

/** Get limits for a bot type, falling back to defaults. */
export function getLimitsForBot(
  botType: string,
  overrides?: Partial<PositionLimits>
): PositionLimits {
  const base = BOT_LIMITS[botType] ?? BOT_LIMITS.default;
  return { ...base, ...overrides };
}
