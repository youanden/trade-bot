/** Polymarket-specific types for CLOB API + Gamma API. */

export interface PolymarketConfig {
  /** Polygon wallet private key (hex) */
  privateKey: string;
  /** CLOB API credentials (derived from wallet) */
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  /** Wallet address */
  address: string;
  /** 0=EOA, 1=POLY_PROXY, 2=GNOSIS_SAFE */
  signatureType?: 0 | 1 | 2;
  /** Proxy wallet funder address (for types 1/2) */
  funderAddress?: string;
  chainId?: number;
}

// ── Gamma API (market discovery) ──

export interface GammaMarket {
  id: string;
  question: string;
  description?: string;
  conditionId: string;
  slug: string;
  resolutionSource?: string;
  endDate?: string;
  liquidity?: string;
  volume?: string;
  clobTokenIds?: string[];
  outcomePrices?: string[];
  outcomes?: string[];
  negRisk?: boolean;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  new?: boolean;
  featured?: boolean;
  groupItemTitle?: string;
  groupItemThreshold?: string;
}

// ── CLOB API ──

export interface ClobMarket {
  condition_id: string;
  question: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
    winner: boolean;
  }>;
  minimum_order_size: number;
  minimum_tick_size: number;
  description?: string;
  category?: string;
  end_date_iso?: string;
  game_start_time?: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  neg_risk: boolean;
  market_slug?: string;
  icon?: string;
}

export interface ClobOrderBook {
  market: string;
  asset_id: string;
  hash: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  timestamp: string;
}

export interface ClobOrderPayload {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: "BUY" | "SELL";
  signatureType: number;
  signature: string;
}

export interface ClobOrderResponse {
  success: boolean;
  errorMsg?: string;
  orderID: string;
  status: "live" | "matched" | "delayed" | "unmatched";
  takingAmount?: string;
  makingAmount?: string;
  transactionsHashes?: string[];
  tradeIDs?: string[];
}

export interface ClobOpenOrder {
  id: string;
  status: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  original_size: string;
  size_matched: string;
  price: string;
  outcome: string;
  created_at: string;
  expiration: string;
  type: string;
}

// ── Contract addresses (Polygon Mainnet) ──

export const POLY_CONTRACTS = {
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const,
  NEG_RISK_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a" as const,
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const,
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const,
  CTF: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const,
} as const;

export const POLY_URLS = {
  CLOB: "https://clob.polymarket.com",
  GAMMA: "https://gamma-api.polymarket.com",
  DATA: "https://data-api.polymarket.com",
  WS_MARKET: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  WS_USER: "wss://ws-subscriptions-clob.polymarket.com/ws/user",
} as const;

// ── EIP-712 types for order signing ──

export const ORDER_EIP712_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
  ],
} as const;

export const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: 137,
} as const;

export const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;
