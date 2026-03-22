import type { BotConfig, TradeRecord, BotStatus } from "../../bots/base";
import { orders, trades, positions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/**
 * SimulatedBot duck-types the BaseBotDO interface for backtest use.
 * Does NOT extend DurableObject or import from "cloudflare:workers".
 * Strategies access this via `(bot as any).config` and `(bot as any).recordTrade(...)`.
 */
export class SimulatedBot {
  /** Public so strategies can access via (bot as any).config */
  public config: BotConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: BunSQLiteDatabase<any>;
  private tradeCount = 0;
  private dbBotId: number;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(config: BotConfig, db: BunSQLiteDatabase<any>) {
    this.config = config;
    this.db = db;
    this.dbBotId = config.dbBotId ?? 1;
  }

  /**
   * Record an order and trade in the in-memory SQLite DB.
   * Returns an incrementing trade count (matches BaseBotDO.recordTrade return pattern).
   *
   * @param trade - Trade record to insert
   */
  async recordTrade(trade: TradeRecord): Promise<number> {
    const now = new Date().toISOString();

    // 1. Insert order
    const [order] = this.db
      .insert(orders)
      .values({
        botInstanceId: this.dbBotId,
        marketId: trade.marketId,
        platform: trade.platform,
        side: trade.side,
        outcome: trade.outcome,
        price: trade.price,
        size: trade.size,
        filledSize: trade.size,
        status: "filled",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();

    // 2. Insert trade
    this.db
      .insert(trades)
      .values({
        orderId: order.id,
        botInstanceId: this.dbBotId,
        marketId: trade.marketId,
        filledPrice: trade.price,
        filledSize: trade.size,
        tradeReason: trade.reason,
        executedAt: now,
      })
      .run();

    // 3. Upsert position
    this.upsertPosition(trade);

    return ++this.tradeCount;
  }

  /** Update or create a position for this bot + market. Mirrors BaseBotDO.upsertPosition. */
  private upsertPosition(trade: TradeRecord): void {
    const existing = this.db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.botInstanceId, this.dbBotId),
          eq(positions.marketId, trade.marketId),
          eq(positions.outcome, trade.outcome),
          eq(positions.status, "open")
        )
      )
      .all();

    if (existing.length > 0) {
      const pos = existing[0];
      const isAdding = trade.side === "buy";
      const newSize = isAdding
        ? pos.size + trade.size
        : pos.size - trade.size;

      if (newSize <= 0) {
        // Close position
        this.db
          .update(positions)
          .set({
            size: 0,
            status: "closed",
            closedAt: new Date().toISOString(),
          })
          .where(eq(positions.id, pos.id))
          .run();
      } else {
        // Update position with new avg entry
        const newAvg = isAdding
          ? (pos.avgEntry * pos.size + trade.price * trade.size) / newSize
          : pos.avgEntry; // avg unchanged on partial close

        this.db
          .update(positions)
          .set({
            size: newSize,
            avgEntry: newAvg,
            currentPrice: trade.price,
          })
          .where(eq(positions.id, pos.id))
          .run();
      }
    } else if (trade.side === "buy") {
      // New position
      this.db
        .insert(positions)
        .values({
          botInstanceId: this.dbBotId,
          marketId: trade.marketId,
          platform: trade.platform,
          outcome: trade.outcome,
          size: trade.size,
          avgEntry: trade.price,
          currentPrice: trade.price,
          status: "open",
        })
        .run();
    }
  }

  /** Returns simulated bot status. Always running: true during backtest. */
  getStatus(): BotStatus {
    return {
      id: "sim-bot",
      botType: this.config.botType,
      name: this.config.name,
      running: true,
      lastTick: null,
      tickCount: this.tradeCount,
      error: null,
    };
  }

  /** Expose trade count for the backtest engine to read. */
  get _tradeCount(): number {
    return this.tradeCount;
  }
}
