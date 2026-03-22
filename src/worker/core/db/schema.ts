import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── Markets ──

export const markets = sqliteTable("markets", {
  id: integer().primaryKey({ autoIncrement: true }),
  platform: text().notNull(), // 'polymarket' | 'kalshi'
  platformId: text("platform_id").notNull(),
  title: text().notNull(),
  description: text(),
  category: text(),
  status: text().notNull().default("active"), // active | closed | resolved
  resolution: text(), // yes | no | null
  endDate: text("end_date"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  clobTokenIds: text("clob_token_ids"),        // JSON array: '["tokenId1","tokenId2"]'
  negRiskMarketId: text("neg_risk_market_id"), // Gamma API negRiskMarketID, nullable
});

export const marketLinks = sqliteTable("market_links", {
  id: integer().primaryKey({ autoIncrement: true }),
  marketIdA: integer("market_id_a")
    .notNull()
    .references(() => markets.id),
  marketIdB: integer("market_id_b")
    .notNull()
    .references(() => markets.id),
  confidence: real().notNull().default(0),
  matchMethod: text("match_method"), // 'title' | 'manual' | 'llm'
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ── Prices ──

export const prices = sqliteTable("prices", {
  id: integer().primaryKey({ autoIncrement: true }),
  marketId: integer("market_id")
    .notNull()
    .references(() => markets.id),
  yesPrice: real("yes_price"),
  noPrice: real("no_price"),
  yesBid: real("yes_bid"),
  yesAsk: real("yes_ask"),
  volume: real(),
  timestamp: text().notNull().default(sql`(datetime('now'))`),
});

// ── Bot Instances ──

export const botInstances = sqliteTable("bot_instances", {
  id: integer().primaryKey({ autoIncrement: true }),
  botType: text("bot_type").notNull(),
  name: text().notNull(),
  status: text().notNull().default("stopped"), // stopped | running | error | paused
  config: text({ mode: "json" }).$type<Record<string, unknown>>(),
  durableObjectId: text("durable_object_id"),
  heartbeat: text(),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ── Orders ──

export const orders = sqliteTable("orders", {
  id: integer().primaryKey({ autoIncrement: true }),
  botInstanceId: integer("bot_instance_id").references(() => botInstances.id),
  marketId: integer("market_id")
    .notNull()
    .references(() => markets.id),
  platform: text().notNull(),
  platformOrderId: text("platform_order_id"),
  side: text().notNull(), // 'buy' | 'sell'
  outcome: text().notNull(), // 'yes' | 'no'
  price: real().notNull(),
  size: real().notNull(),
  filledSize: real("filled_size").default(0),
  status: text().notNull().default("pending"), // pending | open | filled | partial | cancelled | failed
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ── Trades ──

export const trades = sqliteTable("trades", {
  id: integer().primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id),
  botInstanceId: integer("bot_instance_id").references(() => botInstances.id),
  marketId: integer("market_id")
    .notNull()
    .references(() => markets.id),
  filledPrice: real("filled_price").notNull(),
  filledSize: real("filled_size").notNull(),
  fee: real().default(0),
  pnl: real(),
  tradeReason: text("trade_reason"),
  executedAt: text("executed_at").notNull().default(sql`(datetime('now'))`),
});

// ── Positions ──

export const positions = sqliteTable("positions", {
  id: integer().primaryKey({ autoIncrement: true }),
  botInstanceId: integer("bot_instance_id").references(() => botInstances.id),
  marketId: integer("market_id")
    .notNull()
    .references(() => markets.id),
  platform: text().notNull(),
  outcome: text().notNull(), // 'yes' | 'no'
  size: real().notNull(),
  avgEntry: real("avg_entry").notNull(),
  currentPrice: real("current_price"),
  unrealizedPnl: real("unrealized_pnl"),
  status: text().notNull().default("open"), // open | closed
  openedAt: text("opened_at").notNull().default(sql`(datetime('now'))`),
  closedAt: text("closed_at"),
});

// ── Bot Metrics ──

export const botMetrics = sqliteTable("bot_metrics", {
  id: integer().primaryKey({ autoIncrement: true }),
  botInstanceId: integer("bot_instance_id")
    .notNull()
    .references(() => botInstances.id),
  totalPnl: real("total_pnl").default(0),
  winRate: real("win_rate"),
  sharpe: real(),
  maxDrawdown: real("max_drawdown"),
  totalTrades: integer("total_trades").default(0),
  snapshotAt: text("snapshot_at").notNull().default(sql`(datetime('now'))`),
});

// ── Tracked Traders (for copy-trading) ──

export const trackedTraders = sqliteTable("tracked_traders", {
  id: integer().primaryKey({ autoIncrement: true }),
  platform: text().notNull(),
  traderId: text("trader_id").notNull(),
  alias: text(),
  winRate: real("win_rate"),
  totalPnl: real("total_pnl"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ── Audit Log ──

export const auditLog = sqliteTable("audit_log", {
  id: integer().primaryKey({ autoIncrement: true }),
  botInstanceId: integer("bot_instance_id").references(() => botInstances.id),
  action: text().notNull(),
  details: text({ mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
