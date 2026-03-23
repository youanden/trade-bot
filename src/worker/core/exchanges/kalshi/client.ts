import type {
  ExchangeClient,
  MarketInfo,
  OrderRequest,
  OrderResult,
  OrderBook,
  PositionInfo,
} from "../types";
import {
  type KalshiConfig,
  type KalshiMarket,
  type KalshiOrder,
  type KalshiPosition,
  type KalshiOrderBook,
  KALSHI_URLS,
} from "./types";
import { Logger } from "../../utils/logger";

export class KalshiClient implements ExchangeClient {
  readonly platform = "kalshi" as const;
  private config: KalshiConfig;
  private baseUrl: string;
  private log: Logger;
  private signingKey: CryptoKey | null = null;

  constructor(config: KalshiConfig) {
    this.config = { environment: "prod", ...config };
    this.baseUrl = KALSHI_URLS[this.config.environment!].rest;
    this.log = new Logger({ exchange: "kalshi" });
  }

  // ── Market Discovery ──

  async getMarkets(params?: {
    limit?: number;
    cursor?: string;
    status?: string;
  }): Promise<{ markets: MarketInfo[]; nextCursor?: string }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    if (params?.status) {
      // Kalshi API uses "open" for active markets, but response objects use "active"
      const apiStatus = params.status === "active" ? "open" : params.status;
      searchParams.set("status", apiStatus);
    }

    const res = await this.apiFetch(`/markets?${searchParams.toString()}`);
    const data = await res.json() as any;

    const markets = (data.markets ?? []).map((m: KalshiMarket) =>
      this.toMarketInfo(m)
    );

    return { markets, nextCursor: data.cursor || undefined };
  }

  async getMarket(ticker: string): Promise<MarketInfo> {
    const res = await this.apiFetch(`/markets/${ticker}`);
    const data = await res.json() as any;
    return this.toMarketInfo(data.market);
  }

  // ── Pricing ──

  async getPrice(
    ticker: string
  ): Promise<{ yes: number; no: number }> {
    const market = await this.getMarket(ticker);
    return {
      yes: market.yesPrice ?? 0,
      no: market.noPrice ?? 0,
    };
  }

  async getOrderBook(ticker: string): Promise<OrderBook> {
    const res = await this.apiFetch(`/markets/${ticker}/orderbook`);
    const data = await res.json() as any;

    if (!data.orderbook) {
      return { bids: [], asks: [] };
    }

    const book: KalshiOrderBook = data.orderbook;

    return {
      bids: (book.yes ?? []).map(([price, size]) => ({
        price: Number(price),
        size,
      })),
      asks: (book.no ?? []).map(([price, size]) => ({
        price: Number(price),
        size,
      })),
    };
  }

  // ── Trading ──

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const body: Record<string, unknown> = {
      ticker: order.marketId,
      side: order.outcome,
      action: order.side,
      count: Math.round(order.size),
      time_in_force:
        order.timeInForce === "fok"
          ? "fill_or_kill"
          : order.timeInForce === "ioc"
            ? "immediate_or_cancel"
            : "good_till_canceled",
    };

    // Set price based on outcome
    if (order.outcome === "yes") {
      body.yes_price_dollars = order.price.toFixed(2);
    } else {
      body.no_price_dollars = order.price.toFixed(2);
    }

    if (order.postOnly) body.post_only = true;

    const res = await this.apiFetch("/portfolio/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;
    const o: KalshiOrder = data.order;

    return {
      orderId: o.order_id,
      status: this.mapStatus(o.status),
      filledSize: o.fill_count_fp ? Number(o.fill_count_fp) : undefined,
      remainingSize: o.remaining_count_fp
        ? Number(o.remaining_count_fp)
        : undefined,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.apiFetch(`/portfolio/orders/${orderId}`, {
      method: "DELETE",
    });
  }

  async getOrder(orderId: string): Promise<OrderResult> {
    const res = await this.apiFetch(`/portfolio/orders/${orderId}`);
    const data = await res.json() as any;
    const o: KalshiOrder = data.order;
    return {
      orderId: o.order_id,
      status: this.mapStatus(o.status),
      filledSize: o.fill_count_fp ? Number(o.fill_count_fp) : undefined,
      remainingSize: o.remaining_count_fp
        ? Number(o.remaining_count_fp)
        : undefined,
    };
  }

  async getOpenOrders(ticker?: string): Promise<OrderResult[]> {
    const params = new URLSearchParams({ status: "resting" });
    if (ticker) params.set("ticker", ticker);

    const res = await this.apiFetch(`/portfolio/orders?${params.toString()}`);
    const data = await res.json() as any;

    return (data.orders ?? []).map((o: KalshiOrder) => ({
      orderId: o.order_id,
      status: this.mapStatus(o.status),
      filledSize: o.fill_count_fp ? Number(o.fill_count_fp) : undefined,
      remainingSize: o.remaining_count_fp
        ? Number(o.remaining_count_fp)
        : undefined,
    }));
  }

  // ── Portfolio ──

  async getPositions(): Promise<PositionInfo[]> {
    const res = await this.apiFetch("/portfolio/positions");
    const data = await res.json() as any;

    return (data.market_positions ?? []).map((p: KalshiPosition) => ({
      marketId: p.ticker,
      outcome: (p.position > 0 ? "yes" : "no") as "yes" | "no",
      size: Math.abs(p.position),
      avgEntry: 0, // Kalshi doesn't return avg entry directly
    }));
  }

  async getBalance(): Promise<number> {
    const res = await this.apiFetch("/portfolio/balance");
    const data = await res.json() as any;
    // Balance is in cents, convert to dollars
    return (data.balance ?? 0) / 100;
  }

  // ── RSA-PSS Signing (WebCrypto) ──

  private async getSigningKey(): Promise<CryptoKey> {
    if (this.signingKey) return this.signingKey;

    // Parse PEM to binary
    const pem = this.config.privateKeyPem
      .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
      .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
      .replace(/\s/g, "");
    const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

    this.signingKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["sign"]
    );

    return this.signingKey;
  }

  private async sign(
    timestampMs: string,
    method: string,
    path: string
  ): Promise<string> {
    const key = await this.getSigningKey();
    // Strip query params for signing
    const pathNoQuery = path.split("?")[0];
    // Kalshi requires the full URL path (including baseUrl pathname prefix)
    // e.g. /trade-api/v2 + /portfolio/orders = /trade-api/v2/portfolio/orders
    const basePathPrefix = new URL(this.baseUrl).pathname;
    const message = timestampMs + method.toUpperCase() + basePathPrefix + pathNoQuery;

    const signature = await crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 32 }, // SHA-256 digest length
      key,
      new TextEncoder().encode(message)
    );

    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  private async apiFetch(
    path: string,
    opts?: { method?: string; body?: string }
  ): Promise<Response> {
    const method = opts?.method ?? "GET";
    const timestampMs = Date.now().toString();
    const signature = await this.sign(timestampMs, method, path);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "KALSHI-ACCESS-KEY": this.config.apiKeyId,
      "KALSHI-ACCESS-TIMESTAMP": timestampMs,
      "KALSHI-ACCESS-SIGNATURE": signature,
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts?.body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kalshi ${method} ${path} ${res.status}: ${text}`);
    }

    return res;
  }

  // ── Helpers ──

  private toMarketInfo(m: KalshiMarket): MarketInfo {
    return {
      platformId: m.ticker,
      platform: "kalshi",
      title: m.title,
      category: m.category,
      endDate: m.close_time,
      status:
        m.status === "settled"
          ? "resolved"
          : m.status === "closed"
            ? "closed"
            : "active",
      yesPrice: m.yes_bid_dollars
        ? (Number(m.yes_bid_dollars) + Number(m.yes_ask_dollars ?? m.yes_bid_dollars)) / 2
        : m.last_price_dollars
          ? Number(m.last_price_dollars)
          : undefined,
      noPrice: m.no_bid_dollars
        ? (Number(m.no_bid_dollars) + Number(m.no_ask_dollars ?? m.no_bid_dollars)) / 2
        : undefined,
      volume: m.volume,
      meta: {
        eventTicker: m.event_ticker,
        subtitle: m.subtitle,
        openInterest: m.open_interest,
        result: m.result,
      },
    };
  }

  private mapStatus(
    s: string
  ): "open" | "filled" | "partial" | "failed" | "cancelled" {
    switch (s) {
      case "resting":
      case "pending":
        return "open";
      case "executed":
        return "filled";
      case "canceled":
        return "cancelled";
      default:
        return "open";
    }
  }
}
