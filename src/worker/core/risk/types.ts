/** Risk management types — implemented in Phase 3. */

export interface KellyParams {
  probability: number;
  odds: number;
  bankroll: number;
  fraction?: number; // Kelly fraction (default 0.25 = quarter Kelly)
}

export interface PositionLimits {
  maxPositionSize: number;
  maxTotalExposure: number;
  maxLossPerTrade: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
}

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
  suggestedSize?: number;
}
