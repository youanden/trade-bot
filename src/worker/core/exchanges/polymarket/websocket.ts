import type { PriceUpdate, ExchangeWebSocketHandlers } from "../types";
import { Logger } from "../../utils/logger";

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const PING_INTERVAL_MS = 10_000;

export class PolymarketWebSocket {
  private ws: WebSocket | null = null;
  private handlers: ExchangeWebSocketHandlers;
  private tokenIds: string[];
  private log: Logger;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(tokenIds: string[], handlers: ExchangeWebSocketHandlers) {
    this.tokenIds = tokenIds;
    this.handlers = handlers;
    this.log = new Logger({ ws: "polymarket" });
  }

  connect(): void {
    this.ws = new WebSocket(WS_URL);

    this.ws.addEventListener("open", () => {
      this.log.info("ws:connected");
      this.subscribe();
      this.startPing();
    });

    this.ws.addEventListener("message", (event) => {
      const data =
        typeof event.data === "string" ? event.data : String(event.data);
      if (data === "PONG") return;

      try {
        const msg = JSON.parse(data);
        this.handleMessage(msg);
      } catch {
        this.log.warn("ws:parse-error", { data });
      }
    });

    this.ws.addEventListener("close", () => {
      this.log.info("ws:closed");
      this.stopPing();
      this.handlers.onClose?.();
    });

    this.ws.addEventListener("error", (event) => {
      this.log.error("ws:error");
      this.handlers.onError?.(new Error("WebSocket error"));
    });
  }

  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  addTokens(tokenIds: string[]): void {
    this.tokenIds = [...new Set([...this.tokenIds, ...tokenIds])];
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribe();
    }
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "market",
        assets_ids: this.tokenIds,
        custom_feature_enabled: true,
      })
    );
    this.log.info("ws:subscribed", { tokens: this.tokenIds.length });
  }

  private handleMessage(msg: any): void {
    if (!msg.event_type) return;

    switch (msg.event_type) {
      case "price_change":
      case "best_bid_ask": {
        const update: PriceUpdate = {
          marketId: msg.asset_id ?? msg.market ?? "",
          platform: "polymarket",
          yesBid: msg.bid ? Number(msg.bid) : undefined,
          yesAsk: msg.ask ? Number(msg.ask) : undefined,
          lastPrice: msg.price ? Number(msg.price) : undefined,
          timestamp: msg.timestamp ?? new Date().toISOString(),
        };
        this.handlers.onPrice?.(update);
        break;
      }
      case "last_trade_price": {
        const update: PriceUpdate = {
          marketId: msg.asset_id ?? "",
          platform: "polymarket",
          lastPrice: msg.price ? Number(msg.price) : undefined,
          timestamp: msg.timestamp ?? new Date().toISOString(),
        };
        this.handlers.onPrice?.(update);
        break;
      }
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("PING");
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
