import { Hono } from "hono";
import { createDb } from "../../core/db/client";
import { botInstances, auditLog } from "../../core/db/schema";
import { eq, desc } from "drizzle-orm";
import type { BotConfig } from "../../bots/base";

const app = new Hono<{ Bindings: Env }>();

/** List all bot instances */
app.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const bots = await db.select().from(botInstances).all();
  return c.json(bots);
});

/** Get single bot */
app.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [bot] = await db
    .select()
    .from(botInstances)
    .where(eq(botInstances.id, id));
  if (!bot) return c.json({ error: "Not found" }, 404);
  return c.json(bot);
});

/** Create a new bot instance */
app.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    botType: string;
    name: string;
    config?: Record<string, unknown>;
  }>();

  const doId = c.env.BOT_DO.newUniqueId();

  const [bot] = await db
    .insert(botInstances)
    .values({
      botType: body.botType,
      name: body.name,
      config: body.config ?? {},
      durableObjectId: doId.toString(),
    })
    .returning();

  return c.json(bot, 201);
});

/** Start a bot */
app.post("/:id/start", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [bot] = await db
    .select()
    .from(botInstances)
    .where(eq(botInstances.id, id));

  if (!bot) return c.json({ error: "Not found" }, 404);
  if (!bot.durableObjectId)
    return c.json({ error: "No DO ID assigned" }, 400);

  const doId = c.env.BOT_DO.idFromString(bot.durableObjectId);
  const stub = c.env.BOT_DO.get(doId);

  const config: BotConfig = {
    botType: bot.botType,
    name: bot.name,
    tickIntervalMs:
      (bot.config as Record<string, unknown>)?.tickIntervalMs as number ??
      60_000,
    dbBotId: bot.id,
    ...(bot.config as Record<string, unknown>),
  };

  await (stub as any).start(config);

  await db
    .update(botInstances)
    .set({ status: "running", updatedAt: new Date().toISOString() })
    .where(eq(botInstances.id, id));

  return c.json({ ok: true });
});

/** Stop a bot */
app.post("/:id/stop", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [bot] = await db
    .select()
    .from(botInstances)
    .where(eq(botInstances.id, id));

  if (!bot) return c.json({ error: "Not found" }, 404);
  if (!bot.durableObjectId)
    return c.json({ error: "No DO ID assigned" }, 400);

  const doId = c.env.BOT_DO.idFromString(bot.durableObjectId);
  const stub = c.env.BOT_DO.get(doId);

  await (stub as any).stop();

  await db
    .update(botInstances)
    .set({ status: "stopped", updatedAt: new Date().toISOString() })
    .where(eq(botInstances.id, id));

  return c.json({ ok: true });
});

/** Force an immediate tick on a running bot */
app.post("/:id/tick", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [bot] = await db
    .select()
    .from(botInstances)
    .where(eq(botInstances.id, id));

  if (!bot) return c.json({ error: "Not found" }, 404);
  if (!bot.durableObjectId)
    return c.json({ error: "No DO ID assigned" }, 400);

  const doId = c.env.BOT_DO.idFromString(bot.durableObjectId);
  const stub = c.env.BOT_DO.get(doId);

  await (stub as any).forceTick();

  return c.json({ ok: true });
});

/** Get bot status from DO */
app.get("/:id/status", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [bot] = await db
    .select()
    .from(botInstances)
    .where(eq(botInstances.id, id));

  if (!bot) return c.json({ error: "Not found" }, 404);
  if (!bot.durableObjectId)
    return c.json({ error: "No DO ID assigned" }, 400);

  const doId = c.env.BOT_DO.idFromString(bot.durableObjectId);
  const stub = c.env.BOT_DO.get(doId);

  const status = await (stub as any).getStatus();
  return c.json(status);
});

/** Update bot config (partial merge) */
app.patch("/:id/config", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const [bot] = await db
    .select()
    .from(botInstances)
    .where(eq(botInstances.id, id));
  if (!bot) return c.json({ error: "Not found" }, 404);

  const merged = { ...(bot.config as Record<string, unknown>), ...body };

  const [updated] = await db
    .update(botInstances)
    .set({ config: merged, updatedAt: new Date().toISOString() })
    .where(eq(botInstances.id, id))
    .returning();

  // Forward config update to the live DO if bot is running
  if (bot.durableObjectId && bot.status === "running") {
    const doId = c.env.BOT_DO.idFromString(bot.durableObjectId);
    const stub = c.env.BOT_DO.get(doId);
    await (stub as any).updateConfig(body);
  }

  return c.json(updated);
});

/** Get recent logs for a bot */
app.get("/:id/logs", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const logs = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.botInstanceId, id))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return c.json(logs);
});

/** Delete a bot */
app.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));

  const [bot] = await db
    .select()
    .from(botInstances)
    .where(eq(botInstances.id, id));
  if (!bot) return c.json({ error: "Not found" }, 404);

  // Stop DO if running
  if (bot.durableObjectId && bot.status === "running") {
    const doId = c.env.BOT_DO.idFromString(bot.durableObjectId);
    const stub = c.env.BOT_DO.get(doId);
    await (stub as any).stop();
  }

  await db.delete(botInstances).where(eq(botInstances.id, id));
  return c.json({ ok: true });
});

export default app;
