// Crowd-wisdom leaderboard for Kalshi: fetches top markets by volume as trading signals.
// Kalshi has no public trader leaderboard, so this uses high-volume markets as
// proxies for crowd conviction. The dominant side (YES/NO based on price skew)
// is returned as the "trade signal" for the copy-trader strategy.

import { KALSHI_URLS } from "./types";
import type { KalshiMarket } from "./types";

export interface KalshiLeaderboardEntry {
  rank: number;
  /** Market ticker — used as the "traderId" in crowd-wisdom copy mode */
  ticker: string;
  title: string;
  volume: number;
  volume24h: number;
  openInterest: number;
  /** Derived from last_price_dollars: "yes" if price > 0.50, else "no" */
  dominantSide: "yes" | "no";
  /** Price on the dominant side */
  dominantPrice: number;
}

export interface KalshiLeaderboardParams {
  /** Max entries to return after filtering. Default: 10 */
  limit?: number;
  /** Filter out markets below this volume threshold. Default: 0 */
  minVolume?: number;
  /** Optional Kalshi category filter (e.g. "politics", "economics") */
  category?: string;
  /** Market status filter. Default: "open" */
  status?: string;
}

/**
 * Fetch top Kalshi markets by volume as crowd-wisdom trading signals.
 * Uses the public markets endpoint — no auth required.
 * @param params - Optional filter and pagination params
 */
export async function fetchKalshiLeaderboard(
  params: KalshiLeaderboardParams = {},
): Promise<KalshiLeaderboardEntry[]> {
  const fetchLimit = Math.max((params.limit ?? 10) * 5, 50);
  const qs = new URLSearchParams();
  qs.set("limit", String(fetchLimit));
  qs.set("status", params.status ?? "open");
  if (params.category) qs.set("category", params.category);

  const url = `${KALSHI_URLS.prod.rest}/markets?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Kalshi markets API ${res.status}: ${await res.text()}`);
  }

  const data: { markets?: KalshiMarket[] } = await res.json();
  const markets = data.markets ?? [];

  const minVolume = params.minVolume ?? 0;

  const filtered = markets.filter(
    (m) => m.status === "active" && (m.volume ?? 0) > minVolume,
  );

  filtered.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  const topN = filtered.slice(0, params.limit ?? 10);

  return topN.map((m, i) => {
    const lastPrice = Number(m.last_price_dollars ?? "0.50");
    const dominantSide: "yes" | "no" = lastPrice > 0.5 ? "yes" : "no";
    return {
      rank: i + 1,
      ticker: m.ticker,
      title: m.title,
      volume: m.volume ?? 0,
      volume24h: m.volume_24h ?? 0,
      openInterest: m.open_interest ?? 0,
      dominantSide,
      dominantPrice: lastPrice,
    };
  });
}
