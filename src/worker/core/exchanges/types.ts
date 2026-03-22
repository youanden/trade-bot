/** Unified exchange client interface for Polymarket + Kalshi. */

export interface MarketInfo {
  platformId: string;
  platform: "polymarket" | "kalshi";
  title: string;
  description?: string;
  category?: string;
  endDate?: string;
  status: "active" | "closed" | "resolved";
  yesPrice?: number;
  noPrice?: number;
  volume?: number;
  /** Platform-specific metadata */
  meta?: Record<string, unknown>;
}

export interface OrderRequest {
  marketId: string;
  side: "buy" | "sell";
  outcome: "yes" | "no";
  price: number;
  size: number;
  timeInForce?: "gtc" | "fok" | "ioc";
  postOnly?: boolean;
  /** Polymarket neg-risk market flag — routes to NEG_RISK_EXCHANGE contract when true */
  isNegRisk?: boolean;
}

export interface OrderResult {
  orderId: string;
  status: "open" | "filled" | "partial" | "failed" | "cancelled";
  filledPrice?: number;
  filledSize?: number;
  remainingSize?: number;
}

export interface PositionInfo {
  marketId: string;
  outcome: "yes" | "no";
  size: number;
  avgEntry: number;
  currentPrice?: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp?: string;
}

export interface PriceUpdate {
  marketId: string;
  platform: "polymarket" | "kalshi";
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  lastPrice?: number;
  volume?: number;
  timestamp: string;
}

export interface ExchangeClient {
  platform: "polymarket" | "kalshi";

  /** Market discovery */
  getMarkets(params?: {
    limit?: number;
    cursor?: string;
    status?: string;
  }): Promise<{ markets: MarketInfo[]; nextCursor?: string }>;
  getMarket(id: string): Promise<MarketInfo>;

  /** Pricing */
  getPrice(id: string): Promise<{ yes: number; no: number }>;
  getOrderBook(id: string): Promise<OrderBook>;

  /** Trading */
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<OrderResult>;
  getOpenOrders(marketId?: string): Promise<OrderResult[]>;

  /** Portfolio */
  getPositions(): Promise<PositionInfo[]>;
  getBalance(): Promise<number>;
}

/** WebSocket event handler types */
export interface ExchangeWebSocketHandlers {
  onPrice?: (update: PriceUpdate) => void;
  onOrderFill?: (data: {
    orderId: string;
    filledPrice: number;
    filledSize: number;
  }) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}
