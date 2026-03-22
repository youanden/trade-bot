import type {
  ExchangeClient,
  MarketInfo,
  OrderBook,
  OrderResult,
  PositionInfo,
  OrderRequest,
} from "../../src/worker/core/exchanges/types";
import type { TestDb } from "./db";

/**
 * MockExchangeClient implements the full ExchangeClient interface.
 * Provides controllable state for test assertions (placedOrders, markets, priceMap).
 */
export class MockExchangeClient implements ExchangeClient {
  platform: "polymarket" | "kalshi" = "polymarket";
  markets: MarketInfo[] = [];
  priceMap: Record<string, { yes: number; no: number }> = {};
  balance = 1000;
  placedOrders: OrderRequest[] = [];

  async getMarkets(): Promise<{ markets: MarketInfo[]; nextCursor?: string }> {
    return { markets: this.markets };
  }

  async getMarket(id: string): Promise<MarketInfo> {
    return (
      this.markets.find((m) => m.platformId === id) ?? {
        platformId: id,
        platform: "polymarket",
        title: id,
        status: "active",
      }
    );
  }

  async getPrice(id: string): Promise<{ yes: number; no: number }> {
    return this.priceMap[id] ?? { yes: 0.5, no: 0.5 };
  }

  async getOrderBook(_id: string): Promise<OrderBook> {
    return {
      bids: [{ price: 0.49, size: 100 }],
      asks: [{ price: 0.51, size: 100 }],
    };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    this.placedOrders.push(order);
    return {
      orderId: `mock-order-${this.placedOrders.length}`,
      status: "filled",
      filledPrice: order.price,
      filledSize: order.size,
    };
  }

  async cancelOrder(_orderId: string): Promise<void> {}

  async getOrder(_orderId: string): Promise<OrderResult> {
    return { orderId: "mock-order-1", status: "filled" };
  }

  async getOpenOrders(_marketId?: string): Promise<OrderResult[]> {
    return [];
  }

  async getPositions(): Promise<PositionInfo[]> {
    return [];
  }

  async getBalance(): Promise<number> {
    return this.balance;
  }
}

/**
 * makeMockBot duck-types the BaseBotDO shape that strategies access.
 * Does NOT import BaseBotDO to avoid cloudflare:workers import errors outside Wrangler.
 */
export function makeMockBot(
  config: Record<string, unknown> & { botType: string },
) {
  const trades: Record<string, unknown>[] = [];
  return {
    config: {
      botType: config.botType,
      name: config.name ?? "test-bot",
      tickIntervalMs: config.tickIntervalMs ?? 5000,
      dbBotId: config.dbBotId ?? 1,
      ...config,
    },
    recordTrade: async (trade: Record<string, unknown>) => {
      trades.push(trade);
      return trades.length;
    },
    getStatus: () => ({ running: true, lastTick: new Date().toISOString() }),
    _trades: trades,
  };
}

/**
 * makeTestEnv builds a minimal Env stub for strategy tests.
 * Omits exchange credentials (strategies early-return on createExchangeClient failure).
 * Omits env.AI (LLM strategies early-return when AI binding is absent).
 */
export function makeTestEnv(db: TestDb): Record<string, unknown> {
  return {
    DB: db as unknown,
    BOT_DO: {},
    ASSETS: {},
    ENVIRONMENT: "test",
  };
}

/**
 * mockAI stubs the Workers AI binding (env.AI).
 * Returns valid JSON that both llm-assessor and deep-research strategies can parse.
 */
export const mockAI = {
  run: async (_model: string, _inputs: unknown) => {
    return {
      response: JSON.stringify({
        probability: 0.6,
        reasoning: "mock analysis",
      }),
    };
  },
};
