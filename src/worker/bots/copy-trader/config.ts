import type { BotConfig } from "../base";

export interface CopyTraderConfig extends BotConfig {
  botType: "copy-trader";
  /** Platform to monitor: polymarket or kalshi */
  platform: "polymarket" | "kalshi";
  /** Trader addresses/IDs to copy */
  traderIds: string[];
  /** Max position size per copied trade */
  maxPositionSize: number;
  /** Fraction of the copied trader's size to mirror (0-1) */
  sizeFraction: number;
  /** Max slippage tolerance (e.g. 0.02 = 2%) */
  maxSlippage: number;
  /** Min edge required to copy (absolute price difference) */
  minEdge: number;
  /** Whether to copy sells/closes too */
  copySells: boolean;
  /** When true, populates traderIds from Polymarket leaderboard each refresh interval */
  leaderboardMode?: boolean;
  /** How often to refresh leaderboard (ms). Default: 3_600_000 (1 hour) */
  leaderboardRefreshMs?: number;
  /** How many top traders to copy from leaderboard. Default: 10 */
  leaderboardTopN?: number;
  /** Leaderboard time window to rank by. Default: "WEEK" */
  leaderboardTimePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  /** ISO-8601 timestamp of last leaderboard refresh (internal, stored in DO) */
  _lastLeaderboardRefresh?: string;
  /** Kalshi crowd-wisdom: minimum volume threshold for discovered markets. Default: 1000 */
  kalshiMinVolume?: number;
  /** Kalshi crowd-wisdom: optional category filter (e.g. "politics", "economics") */
  kalshiCategory?: string;
}

export const DEFAULT_COPY_TRADER_CONFIG: Partial<CopyTraderConfig> = {
  botType: "copy-trader",
  tickIntervalMs: 30_000, // Check every 30s
  platform: "polymarket",
  maxPositionSize: 100,
  sizeFraction: 0.5,
  maxSlippage: 0.03,
  minEdge: 0.01,
  copySells: true,
};
