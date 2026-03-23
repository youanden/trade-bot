import { Hono } from "hono";
import { createDb } from "../../core/db/client";
import { trades, orders, markets } from "../../core/db/schema";
import { desc, eq } from "drizzle-orm";

const app = new Hono<{ Bindings: Env }>();

/** List trades with optional filters */
app.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const limit = Number(c.req.query("limit") ?? 50);
  const botId = c.req.query("bot_id");

  let result;
  if (botId) {
    result = await db
      .select()
      .from(trades)
      .where(eq(trades.botInstanceId, Number(botId)))
      .orderBy(desc(trades.executedAt))
      .limit(limit);
  } else {
    result = await db
      .select()
      .from(trades)
      .orderBy(desc(trades.executedAt))
      .limit(limit);
  }

  return c.json(result);
});

/** Get a single trade */
app.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [trade] = await db
    .select()
    .from(trades)
    .where(eq(trades.id, id));
  if (!trade) return c.json({ error: "Not found" }, 404);
  return c.json(trade);
});

/** Manual trade — record a trade without bot execution */
app.post("/manual", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    marketId: number;
    platform: string;
    side: "buy" | "sell";
    outcome: "yes" | "no";
    price: number;
    size: number;
    reason?: string;
  }>();

  const now = new Date().toISOString();

  // Create order
  const [order] = await db
    .insert(orders)
    .values({
      marketId: body.marketId,
      platform: body.platform,
      side: body.side,
      outcome: body.outcome,
      price: body.price,
      size: body.size,
      filledSize: body.size,
      status: "filled",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Create trade
  const [trade] = await db
    .insert(trades)
    .values({
      orderId: order.id,
      marketId: body.marketId,
      filledPrice: body.price,
      filledSize: body.size,
      tradeReason: body.reason ?? "manual",
      executedAt: now,
    })
    .returning();

  return c.json({ order, trade }, 201);
});

export default app;