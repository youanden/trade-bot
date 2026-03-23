/** Market resolution and matching types — implemented in Phase 2. */

export interface UnifiedMarket {
  id: number;
  platform: "polymarket" | "kalshi";
  platformId: string;
  title: string;
  category?: string;
  yesPrice?: number;
  noPrice?: number;
  volume?: number;
  linkedMarketId?: number; // Cross-platform counterpart
}

export interface MarketMatch {
  marketA: UnifiedMarket;
  marketB: UnifiedMarket;
  confidence: number;
  matchMethod: "title" | "manual" | "llm";
}
