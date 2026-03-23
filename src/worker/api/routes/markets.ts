import { Hono } from "hono";
import { createDb } from "../../core/db/client";
import { markets, prices } from "../../core/db/schema";
import { desc, eq, and, like } from "drizzle-orm";
import { MarketResolver } from "../../core/market/resolver";
import { MarketMatcher } from "../../core/market/matcher";
import { createExchangeClient } from "../../core/exchanges/factory";

const app = new Hono<{ Bindings: Env }>();

/** List markets (with latest price data joined from prices table) */
app.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const limit = Number(c.req.query("limit") ?? 100);
  const platform = c.req.query("platform");
  const search = c.req.query("q");

  const result = await db.select().from(markets).orderBy(desc(markets.createdAt)).limit(limit);

  // Fetch all prices and group by marketId, finding latest per market
  const allPrices = await db.select().from(prices);
  const latestPriceByMarket = new Map<number, typeof prices.$inferSelect>();
  for (const row of allPrices) {
    const existing = latestPriceByMarket.get(row.marketId);
    if (!existing || row.timestamp > existing.timestamp) {
      latestPriceByMarket.set(row.marketId, row);
    }
  }

  let filtered = result;
  if (platform) {
    filtered = filtered.filter((m) => m.platform === platform);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((m) => m.title.toLowerCase().includes(q));
  }

  const enriched = filtered.map((m) => {
    const p = latestPriceByMarket.get(m.id);
    return {
      ...m,
      yesPrice: p?.yesPrice ?? null,
      noPrice: p?.noPrice ?? null,
      volume: p?.volume ?? null,
    };
  });

  return c.json(enriched);
});

/** Sync markets from exchanges */
app.post("/sync", async (c) => {
  const db = createDb(c.env.DB);
  let body: { limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // no body is fine
  }
  const limit = body.limit ?? 100;

  const clients = [];
  for (const platform of ["polymarket", "kalshi"] as const) {
    try {
      clients.push(createExchangeClient(c.env, platform));
    } catch {
      // skip platforms where credentials are missing
    }
  }

  if (clients.length === 0) {
    return c.json({ synced: 0, error: "No exchange credentials configured" }, 200);
  }

  const resolver = new MarketResolver(db, clients);
  const count = await resolver.syncMarkets(limit);
  return c.json({ synced: count });
});

/** Get single market */
app.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const [market] = await db.select().from(markets).where(eq(markets.id, id));
  if (!market) return c.json({ error: "Not found" }, 404);
  return c.json(market);
});

/** Find cross-platform matches */
app.get("/matches", async (c) => {
  const db = createDb(c.env.DB);
  const minConfidence = Number(c.req.query("min_confidence") ?? 0.6);
  const matcher = new MarketMatcher(db);
  const matches = await matcher.findMatches(minConfidence);
  return c.json(matches);
});

/** Get linked markets for a market ID */
app.get("/:id/linked", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const matcher = new MarketMatcher(db);
  const linked = await matcher.getLinkedMarkets(id);
  return c.json(linked);
});

/** Save a cross-platform market link */
app.post("/links", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json<{
    marketIdA: number;
    marketIdB: number;
    confidence?: number;
    method?: "title" | "manual" | "llm";
  }>();
  const matcher = new MarketMatcher(db);
  await matcher.saveMatch(
    body.marketIdA,
    body.marketIdB,
    body.confidence ?? 1.0,
    body.method ?? "manual"
  );
  return c.json({ ok: true }, 201);
});

export default app;
