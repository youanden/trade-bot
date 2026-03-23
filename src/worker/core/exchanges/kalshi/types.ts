/** Kalshi-specific types for REST API v2. */

export interface KalshiConfig {
  /** API key ID (e.g. "kalshi_prod_...") */
  apiKeyId: string;
  /** RSA private key in PEM format */
  privateKeyPem: string;
  /** "prod" | "demo" */
  environment?: "prod" | "demo";
}

export const KALSHI_URLS = {
  prod: {
    rest: "https://api.elections.kalshi.com/trade-api/v2",
    ws: "wss://api.elections.kalshi.com/trade-api/ws/v2",
  },
  demo: {
    rest: "https://demo-api.kalshi.co/trade-api/v2",
    ws: "wss://demo-api.kalshi.co/trade-api/ws/v2",
  },
} as const;

// ── API Response Types ──

export interface KalshiEvent {
  event_ticker: string;
  series_ticker: string;
  title: string;
  category: string;
  markets: KalshiMarket[];
}

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle?: string;
  status: "active" | "closed" | "settled";
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  close_time?: string;
  expiration_time?: string;
  result?: "yes" | "no" | "all_no" | "all_yes";
  category?: string;
  rules_primary?: string;
}

export interface KalshiOrderBook {
  ticker: string;
  yes: Array<[string, number]>; // [price_dollars, size]
  no: Array<[string, number]>;
}

export interface KalshiCreateOrder {
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count?: number;
  count_fp?: string;
  yes_price_dollars?: string;
  no_price_dollars?: string;
  time_in_force?: "good_till_canceled" | "fill_or_kill" | "immediate_or_cancel";
  post_only?: boolean;
  reduce_only?: boolean;
  client_order_id?: string;
}

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  status: "resting" | "canceled" | "executed" | "pending";
  side: "yes" | "no";
  action: "buy" | "sell";
  yes_price_dollars?: string;
  no_price_dollars?: string;
  created_time: string;
  expiration_time?: string;
  count_fp?: string;
  remaining_count_fp?: string;
  fill_count_fp?: string;
  client_order_id?: string;
}

export interface KalshiPosition {
  ticker: string;
  market_exposure?: number;
  total_traded?: number;
  resting_orders_count?: number;
  position: number;
  position_fp?: string;
}

export interface KalshiFill {
  trade_id: string;
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count_fp?: string;
  yes_price_dollars?: string;
  no_price_dollars?: string;
  created_time: string;
}

export interface KalshiBalance {
  balance: number;
  available_payout?: number;
}

// ── WebSocket types ──

export interface KalshiWsSubscribe {
  id: number;
  cmd: "subscribe";
  params: {
    channels: string[];
    market_ticker?: string;
    market_tickers?: string[];
  };
}

export interface KalshiTickerUpdate {
  type: "ticker";
  market_ticker: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  yes_bid_size_fp?: string;
  yes_ask_size_fp?: string;
  last_trade_size_fp?: string;
}
