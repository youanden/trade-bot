import type { BotConfig } from "../base";

export interface MarketMakerConfig extends BotConfig {
  botType: "market-maker";
  /** Platform to make markets on */
  platform: "polymarket" | "kalshi";
  /** Market IDs to make on (optional — auto-discovered when absent or empty) */
  marketIds?: string[];
  /** Spread to maintain (e.g. 0.04 = 4 cent spread) */
  spreadWidth: number;
  /** Size per side */
  orderSize: number;
  /** Max inventory (auto-hedge above this) */
  maxInventory: number;
  /** Target number of resting orders per side */
  levels: number;
  /** Max markets to auto-discover when marketIds is empty (default 5) */
  maxMarkets?: number;
  /** Minimum volume filter for auto-discovered markets (default 0) */
  minVolume?: number;
}

export const DEFAULT_MARKET_MAKER_CONFIG: Partial<MarketMakerConfig> = {
  botType: "market-maker",
  tickIntervalMs: 10_000, // Fast ticks for MM
  platform: "polymarket",
  spreadWidth: 0.04,
  orderSize: 50,
  maxInventory: 500,
  levels: 3,
  maxMarkets: 5,
  minVolume: 0,
};
