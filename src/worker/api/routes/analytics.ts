import { Hono } from "hono";
import { createDb } from "../../core/db/client";
import { botMetrics, trades, positions } from "../../core/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import {
  computeBotMetrics,
  snapshotBotMetrics,
  getBotLeaderboard,
} from "../../core/risk/analytics";

const app = new Hono<{ Bindings: Env }>();

/** Get latest metric snapshots for all bots */
app.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const result = await db
    .select()
    .from(botMetrics)
    .orderBy(desc(botMetrics.snapshotAt))
    .limit(50);
  return c.json(result);
});

/** Get aggregated summary stats */
app.get("/summary", async (c) => {
  const db = createDb(c.env.DB);

  const [tradeStats] = await db
    .select({
      totalTrades: sql<number>`count(*)`,
      totalPnl: sql<number>`coalesce(sum(pnl), 0)`,
      totalFees: sql<number>`coalesce(sum(fee), 0)`,
    })
    .from(trades);

  const [positionStats] = await db
    .select({
      openPositions: sql<number>`count(*)`,
      totalExposure: sql<number>`coalesce(sum(size * avg_entry), 0)`,
      unrealizedPnl: sql<number>`coalesce(sum(unrealized_pnl), 0)`,
    })
    .from(positions)
    .where(eq(positions.status, "open"));

  return c.json({
    trades: tradeStats,
    positions: positionStats,
  });
});

/** Bot leaderboard — ranked by PnL */
app.get("/leaderboard", async (c) => {
  const db = createDb(c.env.DB);
  const leaderboard = await getBotLeaderboard(db);
  return c.json(leaderboard);
});

/** Get live-computed metrics for a specific bot */
app.get("/bot/:id", async (c) => {
  const db = createDb(c.env.DB);
  const botId = Number(c.req.param("id"));
  const metrics = await computeBotMetrics(db, botId);
  return c.json(metrics);
});

/** Get metric history for a specific bot */
app.get("/bot/:id/history", async (c) => {
  const db = createDb(c.env.DB);
  const botId = Number(c.req.param("id"));
  const result = await db
    .select()
    .from(botMetrics)
    .where(eq(botMetrics.botInstanceId, botId))
    .orderBy(desc(botMetrics.snapshotAt))
    .limit(100);
  return c.json(result);
});

/** Get PnL time series for charting */
app.get("/pnl-series", async (c) => {
  const db = createDb(c.env.DB);

  const allTrades = await db
    .select({
      pnl: trades.pnl,
      filledPrice: trades.filledPrice,
      filledSize: trades.filledSize,
      executedAt: trades.executedAt,
    })
    .from(trades)
    .orderBy(trades.executedAt);

  // Group by day and compute cumulative PnL
  const dailyPnl = new Map<string, number>();
  let cumulative = 0;

  for (const trade of allTrades) {
    const date = trade.executedAt.split("T")[0];
    const tradePnl = trade.pnl ?? 0;
    cumulative += tradePnl;
    dailyPnl.set(date, cumulative);
  }

  const series = Array.from(dailyPnl.entries()).map(([date, pnl]) => ({
    date,
    pnl,
  }));

  return c.json(series);
});

/** Trigger a metric snapshot for a bot */
app.post("/bot/:id/snapshot", async (c) => {
  const db = createDb(c.env.DB);
  const botId = Number(c.req.param("id"));
  await snapshotBotMetrics(db, botId);
  return c.json({ ok: true }, 201);
});

export default app;
