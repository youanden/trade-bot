import type {
  ExchangeClient,
  MarketInfo,
  OrderBook,
  OrderResult,
  PositionInfo,
  OrderRequest,
} from "../exchanges/types";
import type { PriceFeed } from "./feed";
import { createPrng } from "./prng";

export interface SimClientConfig {
  platform: "polymarket" | "kalshi";
  /** PriceFeed wrapping the generated scenario */
  feed: PriceFeed;
  /** Returns the current simulated clock time as ISO-8601 string */
  simulatedNow: () => string;
  /** Starting virtual balance in USD */
  virtualBalance: number;
  /** Polymarket taker fee rate, default 0.02 (2%) */
  takerFeeRate?: number;
  /** Probability [0,1] of a taker order being partially filled, default 0 */
  partialFillRate?: number;
  /** Probability [0,1] of an order failing (models leg-2 failure), default 0 */
  leg2FailRate?: number;
  /** PRNG seed for deterministic fill behaviour, default 1 */
  seed?: number;
}

/**
 * SimExchangeClient implements ExchangeClient using a PriceFeed from a
 * generated scenario. It tracks a virtual balance, applies platform-specific
 * fees, and models partial fills and leg-2 failures via a seeded PRNG.
 *
 * Used in backtests to replace real exchange clients with a no-lookahead,
 * fee-aware simulation.
 */
export class SimExchangeClient implements ExchangeClient {
  readonly platform: "polymarket" | "kalshi";

  private readonly feed: PriceFeed;
  private readonly getNow: () => string;
  private readonly takerFeeRate: number;
  private readonly partialFillRate: number;
  private readonly leg2FailRate: number;
  private readonly rng: () => number;

  private balance: number;
  private orderCounter: number = 0;
  private readonly orders: Map<string, OrderResult> = new Map();
  private readonly positions: Map<string, PositionInfo> = new Map();

  constructor(config: SimClientConfig) {
    this.platform = config.platform;
    this.feed = config.feed;
    this.getNow = config.simulatedNow;
    this.balance = config.virtualBalance;
    this.takerFeeRate = config.takerFeeRate ?? 0.02;
    this.partialFillRate = config.partialFillRate ?? 0;
    this.leg2FailRate = config.leg2FailRate ?? 0;
    this.rng = createPrng(config.seed ?? 1);
  }

  // ------------------------------------------------------------------ Markets

  async getMarkets(): Promise<{ markets: MarketInfo[]; nextCursor?: string }> {
    const row = this.feed.latestAt(this.getNow());
    const market: MarketInfo = {
      platformId: `sim-feed`,
      platform: this.platform,
      title: "Simulated market",
      status: "active",
      yesPrice: row?.yesPrice,
      noPrice: row?.noPrice,
    };
    return { markets: [market], nextCursor: undefined };
  }

  async getMarket(id: string): Promise<MarketInfo> {
    const row = this.feed.latestAt(this.getNow());
    return {
      platformId: id,
      platform: this.platform,
      title: id,
      status: "active",
      yesPrice: row?.yesPrice,
      noPrice: row?.noPrice,
    };
  }

  // ------------------------------------------------------------------ Pricing

  async getPrice(_id: string): Promise<{ yes: number; no: number }> {
    const row = this.feed.latestAt(this.getNow());
    if (row === undefined) {
      return { yes: 0.5, no: 0.5 };
    }
    return { yes: row.yesPrice, no: row.noPrice };
  }

  async getOrderBook(_id: string): Promise<OrderBook> {
    const row = this.feed.latestAt(this.getNow());
    const mid = row?.yesPrice ?? 0.5;
    const SPREAD = 0.01;
    return {
      bids: [
        { price: Math.max(0.01, mid - SPREAD), size: 100 },
        { price: Math.max(0.01, mid - SPREAD * 2), size: 200 },
        { price: Math.max(0.01, mid - SPREAD * 3), size: 400 },
      ],
      asks: [
        { price: Math.min(0.99, mid + SPREAD), size: 100 },
        { price: Math.min(0.99, mid + SPREAD * 2), size: 200 },
        { price: Math.min(0.99, mid + SPREAD * 3), size: 400 },
      ],
      timestamp: row?.timestamp,
    };
  }

  // ------------------------------------------------------------------ Trading

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const orderId = `sim-${this.platform}-${String(++this.orderCounter).padStart(4, "0")}`;

    // 1. Roll leg2 failure (models second-leg failure in arb strategies)
    if (this.rng() < this.leg2FailRate) {
      const result: OrderResult = { orderId, status: "failed" };
      this.orders.set(orderId, result);
      return result;
    }

    // 2. Determine taker vs maker
    const isTaker = !order.postOnly;

    // 3. Determine fill size (partial fill modelled for taker orders only)
    let fillSize: number;
    let status: OrderResult["status"];
    if (isTaker && this.rng() < this.partialFillRate) {
      // Partial fill: between 50% and 99% of requested size
      fillSize = order.size * (0.5 + this.rng() * 0.49);
      status = "partial";
    } else {
      fillSize = order.size;
      status = "filled";
    }

    // 4. Get fill price from feed (no-lookahead)
    const row = this.feed.latestAt(this.getNow());
    const feedPrice =
      order.outcome === "yes"
        ? (row?.yesPrice ?? order.price)
        : (row?.noPrice ?? order.price);
    const filledPrice = feedPrice;

    // 5. Compute fee
    const fee =
      this.platform === "polymarket"
        ? this.computePolymarketFee(fillSize, filledPrice, isTaker)
        : this.computeKalshiFee(fillSize, filledPrice);

    // 6. Compute total cost and check against balance
    const cost = fillSize * filledPrice + fee;
    if (cost > this.balance) {
      const result: OrderResult = { orderId, status: "failed" };
      this.orders.set(orderId, result);
      return result;
    }

    // 7. Deduct from balance
    this.balance -= cost;

    // 8. Upsert position
    const posKey = `${order.marketId}-${order.outcome}`;
    const existing = this.positions.get(posKey);
    if (existing) {
      const totalSize = existing.size + fillSize;
      const avgEntry =
        (existing.avgEntry * existing.size + filledPrice * fillSize) /
        totalSize;
      this.positions.set(posKey, {
        ...existing,
        size: totalSize,
        avgEntry,
        currentPrice: filledPrice,
      });
    } else {
      this.positions.set(posKey, {
        marketId: order.marketId,
        outcome: order.outcome,
        size: fillSize,
        avgEntry: filledPrice,
        currentPrice: filledPrice,
      });
    }

    // 9. Build and store result
    const result: OrderResult = {
      orderId,
      status,
      filledPrice,
      filledSize: fillSize,
      remainingSize: status === "partial" ? order.size - fillSize : 0,
    };
    this.orders.set(orderId, result);
    return result;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const existing = this.orders.get(orderId);
    if (existing) {
      this.orders.set(orderId, { ...existing, status: "cancelled" });
    }
  }

  async getOrder(orderId: string): Promise<OrderResult> {
    return this.orders.get(orderId) ?? { orderId, status: "failed" };
  }

  async getOpenOrders(marketId?: string): Promise<OrderResult[]> {
    const open: OrderResult[] = [];
    for (const result of this.orders.values()) {
      if (result.status !== "open") continue;
      if (marketId !== undefined) {
        // orderId encodes the counter but not marketId — open orders must match
        // by checking position map key prefix; skip market filter for now
      }
      open.push(result);
    }
    return open;
  }

  // ---------------------------------------------------------------- Portfolio

  async getPositions(): Promise<PositionInfo[]> {
    return Array.from(this.positions.values());
  }

  async getBalance(): Promise<number> {
    return this.balance;
  }

  // ----------------------------------------------------------- Fee calculators

  /**
   * Polymarket fee: taker pays takerFeeRate * cost, maker pays 0.
   * Fee is applied on filled notional (fillSize * filledPrice).
   */
  private computePolymarketFee(
    fillSize: number,
    filledPrice: number,
    isTaker: boolean,
  ): number {
    if (!isTaker) return 0;
    return fillSize * filledPrice * this.takerFeeRate;
  }

  /**
   * Kalshi fee formula: fee_per_contract = ceil(0.07 * P * (1-P) * 10000) / 10000
   * Applied per filled contract (fillSize).
   *
   * @param fillSize - number of contracts filled
   * @param filledPrice - implied probability price [0, 1]
   */
  private computeKalshiFee(fillSize: number, filledPrice: number): number {
    // Guard against floating point causing exact integers to round up spuriously.
    // e.g. 0.07 * 0.5 * 0.5 * 10000 = 175.0000000000003 → ceil = 176 without guard.
    const raw = 0.07 * filledPrice * (1 - filledPrice) * 10000;
    const feePerContract = Math.ceil(Math.round(raw * 1e8) / 1e8) / 10000;
    return feePerContract * fillSize;
  }
}
