import { DurableObject } from "cloudflare:workers";
import { Logger } from "../core/utils/logger";
import { createDb, type Database } from "../core/db/client";
import { orders, trades, positions, botInstances, auditLog } from "../core/db/schema";
import { eq, and } from "drizzle-orm";

export interface BotConfig {
  botType: string;
  name: string;
  tickIntervalMs: number;
  dbBotId?: number; // ID in bot_instances table
  [key: string]: unknown;
}

export interface BotStatus {
  id: string;
  botType: string;
  name: string;
  running: boolean;
  lastTick: string | null;
  tickCount: number;
  error: string | null;
}

export interface TradeRecord {
  marketId: number;
  platform: string;
  side: "buy" | "sell";
  outcome: "yes" | "no";
  price: number;
  size: number;
  reason?: string;
}

/**
 * Abstract base class for all bot Durable Objects.
 * Subclasses implement `tick()` with strategy-specific logic.
 * The alarm loop handles self-scheduling.
 */
export abstract class BaseBotDO extends DurableObject<Env> {
  protected log: Logger;
  protected config: BotConfig | null = null;
  protected running = false;
  protected lastTick: string | null = null;
  protected tickCount = 0;
  protected lastError: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.log = new Logger({ do: "BotDO", id: ctx.id.toString() });
  }

  /** Strategy-specific tick logic. Override in subclasses. */
  protected abstract tick(): Promise<void>;

  /** Get a Drizzle DB instance from the D1 binding. */
  protected getDb(): Database {
    return createDb(this.env.DB);
  }

  /** Called on each alarm. Runs tick() and schedules next alarm. */
  async alarm(): Promise<void> {
    if (!this.running || !this.config) return;

    try {
      this.log.debug("tick:start", { tickCount: this.tickCount });
      await this.tick();
      this.tickCount++;
      this.lastTick = new Date().toISOString();
      this.lastError = null;

      // Update heartbeat in DB
      if (this.config.dbBotId) {
        await this.getDb()
          .update(botInstances)
          .set({
            heartbeat: this.lastTick,
            updatedAt: this.lastTick,
          })
          .where(eq(botInstances.id, this.config.dbBotId));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.log.error("tick:error", { error: msg });

      // Record error in DB
      if (this.config.dbBotId) {
        await this.getDb()
          .update(botInstances)
          .set({
            errorMessage: msg,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(botInstances.id, this.config.dbBotId));
      }
    }

    // Schedule next tick
    if (this.running && this.config) {
      await this.ctx.storage.setAlarm(
        Date.now() + this.config.tickIntervalMs
      );
    }
  }

  // ── RPC Methods ──

  async start(config: BotConfig): Promise<void> {
    this.config = config;
    this.running = true;
    this.tickCount = 0;
    this.lastError = null;

    await this.ctx.storage.put("config", config);
    await this.ctx.storage.put("running", true);

    this.log.info("bot:start", { botType: config.botType, name: config.name });

    await this.audit("start", { config });

    // Schedule first tick immediately
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.ctx.storage.put("running", false);
    await this.ctx.storage.deleteAlarm();

    await this.audit("stop");
    this.log.info("bot:stop");
  }

  async getStatus(): Promise<BotStatus> {
    return {
      id: this.ctx.id.toString(),
      botType: this.config?.botType ?? "unknown",
      name: this.config?.name ?? "unnamed",
      running: this.running,
      lastTick: this.lastTick,
      tickCount: this.tickCount,
      error: this.lastError,
    };
  }

  async updateConfig(partial: Partial<BotConfig>): Promise<void> {
    if (!this.config) throw new Error("Bot not initialized");
    this.config = { ...this.config, ...partial };
    await this.ctx.storage.put("config", this.config);
    await this.audit("config-update", partial);
    this.log.info("bot:config-updated");
  }

  // ── Trade Recording ──

  /** Record an order and trade in D1. Returns the trade ID. */
  protected async recordTrade(trade: TradeRecord): Promise<number> {
    const db = this.getDb();
    const now = new Date().toISOString();

    // Insert order
    const [order] = await db
      .insert(orders)
      .values({
        botInstanceId: this.config?.dbBotId,
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
      .returning();

    // Insert trade
    const [tradeRow] = await db
      .insert(trades)
      .values({
        orderId: order.id,
        botInstanceId: this.config?.dbBotId,
        marketId: trade.marketId,
        filledPrice: trade.price,
        filledSize: trade.size,
        tradeReason: trade.reason,
        executedAt: now,
      })
      .returning();

    // Upsert position
    await this.upsertPosition(trade);

    this.log.info("trade:recorded", {
      orderId: order.id,
      tradeId: tradeRow.id,
      side: trade.side,
      outcome: trade.outcome,
      price: trade.price,
      size: trade.size,
    });

    return tradeRow.id;
  }

  /** Update or create a position for this bot + market. */
  private async upsertPosition(trade: TradeRecord): Promise<void> {
    const db = this.getDb();

    const existing = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.botInstanceId, this.config?.dbBotId ?? 0),
          eq(positions.marketId, trade.marketId),
          eq(positions.outcome, trade.outcome),
          eq(positions.status, "open")
        )
      );

    if (existing.length > 0) {
      const pos = existing[0];
      const isAdding = trade.side === "buy";
      const newSize = isAdding
        ? pos.size + trade.size
        : pos.size - trade.size;

      if (newSize <= 0) {
        // Close position
        await db
          .update(positions)
          .set({
            size: 0,
            status: "closed",
            closedAt: new Date().toISOString(),
          })
          .where(eq(positions.id, pos.id));
      } else {
        // Update position with new avg entry
        const newAvg = isAdding
          ? (pos.avgEntry * pos.size + trade.price * trade.size) / newSize
          : pos.avgEntry; // avg unchanged on partial close

        await db
          .update(positions)
          .set({
            size: newSize,
            avgEntry: newAvg,
            currentPrice: trade.price,
          })
          .where(eq(positions.id, pos.id));
      }
    } else if (trade.side === "buy") {
      // New position
      await db.insert(positions).values({
        botInstanceId: this.config?.dbBotId,
        marketId: trade.marketId,
        platform: trade.platform,
        outcome: trade.outcome,
        size: trade.size,
        avgEntry: trade.price,
        currentPrice: trade.price,
        status: "open",
      });
    }
  }

  // ── Audit logging ──

  private async audit(
    action: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.getDb().insert(auditLog).values({
        botInstanceId: this.config?.dbBotId,
        action,
        details: details ?? {},
      });
    } catch {
      // Non-critical, don't fail the bot
    }
  }

  /** Restore state from storage on wake-up. */
  protected async hydrate(): Promise<void> {
    const config = await this.ctx.storage.get<BotConfig>("config");
    const running = await this.ctx.storage.get<boolean>("running");
    if (config) this.config = config;
    if (running) this.running = running;
  }
}
