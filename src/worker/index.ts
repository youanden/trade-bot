import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { bearerAuth } from "hono/bearer-auth";

import botsRoutes from "./api/routes/bots";
import tradesRoutes from "./api/routes/trades";
import marketsRoutes from "./api/routes/markets";
import positionsRoutes from "./api/routes/positions";
import analyticsRoutes from "./api/routes/analytics";
import promptTestRoutes from "./api/routes/promptTest";
import { listStrategies } from "./bots/registry";

// Re-export the Durable Object class so Wrangler can find it
export { BotDO } from "./bots/bot-do";

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ──
app.use("*", cors());
app.use("/api/*", honoLogger());

// Auth middleware — skip if no AUTH_TOKEN configured (dev mode)
app.use("/api/*", async (c, next) => {
  const token = c.env.AUTH_TOKEN;
  if (!token) return next();

  // Skip auth for health check
  if (c.req.path === "/api/health") return next();

  return bearerAuth({ token })(c, next);
});

// ── API Routes ──
app.route("/api/bots", botsRoutes);
app.route("/api/trades", tradesRoutes);
app.route("/api/markets", marketsRoutes);
app.route("/api/positions", positionsRoutes);
app.route("/api/analytics", analyticsRoutes);
app.route("/api/prompt-test", promptTestRoutes);

// ── Health check ──
app.get("/api/health", (c) => {
  return c.json({ status: "ok", ts: new Date().toISOString() });
});

// ── Strategies listing ──
app.get("/api/strategies", (c) => {
  return c.json({ strategies: listStrategies() });
});

// ── SPA fallback — serve static assets for non-API routes ──
app.get("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
