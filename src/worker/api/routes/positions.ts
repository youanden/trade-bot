import { Hono } from "hono";
import { createDb } from "../../core/db/client";
import { positions } from "../../core/db/schema";
import { eq, and } from "drizzle-orm";

const app = new Hono<{ Bindings: Env }>();

/** List positions, optionally filtered by status or bot */
app.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const status = c.req.query("status") ?? "open";
  const botId = c.req.query("bot_id");

  let result;
  if (botId) {
    result = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.status, status),
          eq(positions.botInstanceId, Number(botId))
        )
      );
  } else {
    result = await db
      .select()
      .from(positions)
      .where(eq(positions.status, status));
  }

  return c.json(result);
});

/** Get a single position */
app.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [pos] = await db
    .select()
    .from(positions)
    .where(eq(positions.id, id));
  if (!pos) return c.json({ error: "Not found" }, 404);
  return c.json(pos);
});

export default app;
