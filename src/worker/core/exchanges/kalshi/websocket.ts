import type { PriceUpdate, ExchangeWebSocketHandlers } from "../types";
import { KALSHI_URLS } from "./types";
import { Logger } from "../../utils/logger";

export class KalshiWebSocket {
  private ws: WebSocket | null = null;
  private handlers: ExchangeWebSocketHandlers;
  private tickers: string[];
  private wsUrl: string;
  private log: Logger;
  private msgId = 0;

  constructor(
    tickers: string[],
    handlers: ExchangeWebSocketHandlers,
    environment: "prod" | "demo" = "prod"
  ) {
    this.tickers = tickers;
    this.handlers = handlers;
    this.wsUrl = KALSHI_URLS[environment].ws;
    this.log = new Logger({ ws: "kalshi" });
  }

  connect(): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.addEventListener("open", () => {
      this.log.info("ws:connected");
      this.subscribe();
    });

    this.ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(
          typeof event.data === "string" ? event.data : String(event.data)
        );
        this.handleMessage(msg);
      } catch {
        this.log.warn("ws:parse-error");
      }
    });

    this.ws.addEventListener("close", () => {
      this.log.info("ws:closed");
      this.handlers.onClose?.();
    });

    this.ws.addEventListener("error", () => {
      this.log.error("ws:error");
      this.handlers.onError?.(new Error("Kalshi WebSocket error"));
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  addTickers(tickers: string[]): void {
    this.tickers = [...new Set([...this.tickers, ...tickers])];
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribe();
    }
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        id: ++this.msgId,
        cmd: "subscribe",
        params: {
          channels: ["ticker"],
          market_tickers: this.tickers,
        },
      })
    );
    this.log.info("ws:subscribed", { tickers: this.tickers.length });
  }

  private handleMessage(msg: any): void {
    if (msg.type === "ticker") {
      const update: PriceUpdate = {
        marketId: msg.market_ticker,
        platform: "kalshi",
        yesBid: msg.yes_bid_dollars ? Number(msg.yes_bid_dollars) : undefined,
        yesAsk: msg.yes_ask_dollars ? Number(msg.yes_ask_dollars) : undefined,
        lastPrice: msg.last_price_dollars
          ? Number(msg.last_price_dollars)
          : undefined,
        timestamp: new Date().toISOString(),
      };
      this.handlers.onPrice?.(update);
    }
  }
}
