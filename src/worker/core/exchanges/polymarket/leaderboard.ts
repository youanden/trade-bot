// Source: https://data-api.polymarket.com/v1/leaderboard (verified live 2026-03-22)

export interface LeaderboardEntry {
  rank: number;
  proxyWallet: string;
  userName: string;
  pnl: number;
  vol: number;
}

export interface LeaderboardParams {
  timePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  orderBy?: "PNL" | "VOL";
  /** 1-50; default 25 */
  limit?: number;
  offset?: number;
  /** OVERALL | POLITICS | SPORTS | CRYPTO | etc. */
  category?: string;
}

/**
 * Fetch top traders from Polymarket leaderboard API.
 * Public endpoint — no auth required.
 * @param params - Optional query parameters to filter and paginate leaderboard results
 */
export async function fetchLeaderboard(
  params: LeaderboardParams = {},
): Promise<LeaderboardEntry[]> {
  const qs = new URLSearchParams();
  if (params.timePeriod) qs.set("timePeriod", params.timePeriod);
  if (params.orderBy) qs.set("orderBy", params.orderBy);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.category) qs.set("category", params.category);

  const url = `https://data-api.polymarket.com/v1/leaderboard?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Leaderboard API ${res.status}: ${await res.text()}`);
  }

  const data: Array<{
    rank: string;
    proxyWallet: string;
    userName: string;
    pnl: number | null;
    vol: number | null;
  }> = await res.json();

  return data.map((e) => {
    const wallet = (e.proxyWallet ?? "").toLowerCase();
    return {
      rank: Number(e.rank),
      proxyWallet: wallet,
      userName: e.userName || wallet,
      pnl: e.pnl ?? 0,
      vol: e.vol ?? 0,
    };
  });
}
