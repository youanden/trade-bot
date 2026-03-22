import type { Database } from "../db/client";
import { positions, orders, botInstances } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { PositionLimits, RiskCheck } from "./types";
import { Logger } from "../utils/logger";

const log = new Logger({ module: "risk-portfolio" });

const DEFAULT_LIMITS: PositionLimits = {
  maxPositionSize: 500,
  maxTotalExposure: 5000,
  maxLossPerTrade: 100,
  maxDailyLoss: 500,
  maxOpenPositions: 20,
};

/**
 * Portfolio-level risk management.
 * Checks aggregate exposure, circuit breakers, and per-bot limits.
 */
export class PortfolioRisk {
  private db: Database;
  private limits: PositionLimits;
  private readonly clockFn: () => string;

  constructor(
    db: Database,
    limits?: Partial<PositionLimits>,
    clockFn?: () => string,
  ) {
    this.db = db;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.clockFn = clockFn ?? (() => new Date().toISOString());
  }

  /** Check if a new trade passes all risk limits. */
  async checkTrade(params: {
    botInstanceId?: number;
    size: number;
    price: number;
  }): Promise<RiskCheck> {
    const cost = params.size * params.price;

    // 1. Per-trade max loss
    if (cost > this.limits.maxLossPerTrade) {
      return {
        allowed: false,
        reason: `Trade cost $${cost.toFixed(2)} exceeds max loss per trade $${this.limits.maxLossPerTrade}`,
        suggestedSize: Math.floor(this.limits.maxLossPerTrade / params.price),
      };
    }

    // 2. Max position size per market
    if (params.size > this.limits.maxPositionSize) {
      return {
        allowed: false,
        reason: `Size ${params.size} exceeds max position size ${this.limits.maxPositionSize}`,
        suggestedSize: this.limits.maxPositionSize,
      };
    }

    // 3. Total exposure check
    const totalExposure = await this.getTotalExposure();
    if (totalExposure + cost > this.limits.maxTotalExposure) {
      return {
        allowed: false,
        reason: `Total exposure $${(totalExposure + cost).toFixed(2)} would exceed limit $${this.limits.maxTotalExposure}`,
        suggestedSize: Math.max(
          0,
          Math.floor(
            (this.limits.maxTotalExposure - totalExposure) / params.price
          )
        ),
      };
    }

    // 4. Max open positions
    const openCount = await this.getOpenPositionCount();
    if (openCount >= this.limits.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Open positions ${openCount} at limit ${this.limits.maxOpenPositions}`,
      };
    }

    return { allowed: true, suggestedSize: params.size };
  }

  /** Get total exposure across all open positions. */
  async getTotalExposure(): Promise<number> {
    const openPositions = await this.db
      .select()
      .from(positions)
      .where(eq(positions.status, "open"));

    return openPositions.reduce(
      (sum, p) => sum + p.size * p.avgEntry,
      0
    );
  }

  /** Get count of open positions. */
  async getOpenPositionCount(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(positions)
      .where(eq(positions.status, "open"));
    return result[0]?.count ?? 0;
  }

  /** Circuit breaker: check if daily loss exceeds threshold. */
  async isDailyLossBreached(): Promise<boolean> {
    const today = this.clockFn().split("T")[0];
    const dayTrades = await this.db
      .select()
      .from(positions)
      .where(eq(positions.status, "closed"));

    // Filter to today's closes and sum PnL
    const todayLoss = dayTrades
      .filter((t) => t.closedAt?.startsWith(today))
      .reduce((sum, t) => sum + (t.unrealizedPnl ?? 0), 0);

    if (todayLoss < -this.limits.maxDailyLoss) {
      log.warn("circuit-breaker:daily-loss", {
        loss: todayLoss,
        limit: this.limits.maxDailyLoss,
      });
      return true;
    }

    return false;
  }
}
