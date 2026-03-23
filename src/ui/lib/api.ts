const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json();
}

export const api = {
  // Bots
  listBots: () => request<any[]>("/bots"),
  getBot: (id: number) => request<any>(`/bots/${id}`),
  createBot: (data: { botType: string; name: string; config?: Record<string, unknown> }) =>
    request<any>("/bots", { method: "POST", body: JSON.stringify(data) }),
  startBot: (id: number) =>
    request<{ ok: boolean }>(`/bots/${id}/start`, { method: "POST" }),
  stopBot: (id: number) =>
    request<{ ok: boolean }>(`/bots/${id}/stop`, { method: "POST" }),
  deleteBot: (id: number) =>
    request<{ ok: boolean }>(`/bots/${id}`, { method: "DELETE" }),
  getBotStatus: (id: number) => request<any>(`/bots/${id}/status`),
  updateBotConfig: (id: number, config: Record<string, unknown>) =>
    request<any>(`/bots/${id}/config`, {
      method: "PATCH",
      body: JSON.stringify(config),
    }),

  // Trades
  listTrades: (limit?: number) =>
    request<any[]>(`/trades${limit ? `?limit=${limit}` : ""}`),

  // Markets
  listMarkets: (limit?: number) =>
    request<any[]>(`/markets${limit ? `?limit=${limit}` : ""}`),
  syncMarkets: () => request<{ synced: number }>("/markets/sync", { method: "POST" }),

  // Positions
  listPositions: () => request<any[]>("/positions"),

  // Analytics
  getAnalytics: () => request<any[]>("/analytics"),

  // Health
  health: () => request<{ status: string; ts: string }>("/health"),
};
