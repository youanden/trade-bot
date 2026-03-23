import { Hono } from "hono";
import { createDb } from "../../core/db/client";
import { markets, prices } from "../../core/db/schema";
import { desc, eq, and, like, inArray } from "drizzle-orm";
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

const SEED_MARKETS = [
  // Polymarket (10)
  { platform: "polymarket", platformId: "poly-btc-100k-2026", title: "Will Bitcoin reach $100k by end of 2026?", category: "crypto", endDate: "2026-12-31", status: "active" },
  { platform: "polymarket", platformId: "poly-eth-flip-btc", title: "Will Ethereum flip Bitcoin by market cap?", category: "crypto", endDate: "2026-12-31", status: "active" },
  { platform: "polymarket", platformId: "poly-us-recession-2026", title: "Will the US enter a recession in 2026?", category: "finance", endDate: "2026-12-31", status: "active" },
  { platform: "polymarket", platformId: "poly-ai-turing-2027", title: "Will AI pass the Turing test by 2027?", category: "politics", endDate: "2026-12-31", status: "active" },
  { platform: "polymarket", platformId: "poly-spacex-mars-2030", title: "Will SpaceX land humans on Mars by 2030?", category: "politics", endDate: "2026-06-30", status: "active" },
  { platform: "polymarket", platformId: "poly-fed-cut-q2-2026", title: "Will the Fed cut rates in Q2 2026?", category: "finance", endDate: "2026-06-30", status: "active" },
  { platform: "polymarket", platformId: "poly-dems-midterms-2026", title: "Democrats win 2026 midterms?", category: "politics", endDate: "2026-11-03", status: "active" },
  { platform: "polymarket", platformId: "poly-tsla-500-2026", title: "Will Tesla stock exceed $500 in 2026?", category: "finance", endDate: "2026-12-31", status: "active" },
  { platform: "polymarket", platformId: "poly-cat5-hurricane-2026", title: "Will a Category 5 hurricane hit US in 2026?", category: "weather", endDate: "2026-11-30", status: "active" },
  { platform: "polymarket", platformId: "poly-worldcup-europe-2026", title: "World Cup 2026 winner from Europe?", category: "sports", endDate: "2026-07-19", status: "active" },
  // Kalshi (5)
  { platform: "kalshi", platformId: "kalshi-nyc-snow-xmas-2026", title: "Will it snow in NYC on Christmas 2026?", category: "weather", endDate: "2026-12-25", status: "active" },
  { platform: "kalshi", platformId: "kalshi-lakers-nba-2026", title: "Lakers win NBA championship 2026?", category: "sports", endDate: "2026-06-30", status: "active" },
  { platform: "kalshi", platformId: "kalshi-gdp-3pct-2026", title: "US GDP growth above 3% in 2026?", category: "finance", endDate: "2026-12-31", status: "active" },
  { platform: "kalshi", platformId: "kalshi-gas-5-2026", title: "Will gas prices exceed $5/gallon nationally?", category: "finance", endDate: "2026-12-31", status: "active" },
  { platform: "kalshi", platformId: "kalshi-covid-variant-2026", title: "Will a new COVID variant emerge in 2026?", category: "politics", endDate: "2026-12-31", status: "active" },
] as const;

/** Seed dev markets (idempotent) */
app.post("/seed", async (c) => {
  const db = createDb(c.env.DB);

  const existing = await db.select({ platformId: markets.platformId }).from(markets);
  const existingIds = new Set(existing.map((e) => e.platformId));

  const newMarkets = SEED_MARKETS.filter((m) => !existingIds.has(m.platformId));

  if (newMarkets.length === 0) {
    return c.json({ seeded: 0 });
  }

  await db.insert(markets).values(newMarkets);

  const inserted = await db
    .select()
    .from(markets)
    .where(inArray(markets.platformId, newMarkets.map((m) => m.platformId)));

  // Seed prices with realistic values
  const yesPrices = [0.72, 0.38, 0.45, 0.28, 0.12, 0.61, 0.52, 0.33, 0.18, 0.55, 0.25, 0.40, 0.48, 0.35, 0.22];
  const volumes = [125000, 450000, 280000, 190000, 85000, 320000, 410000, 175000, 62000, 235000, 48000, 290000, 380000, 155000, 95000];

  const priceRows = inserted.map((m, i) => {
    const yesPrice = yesPrices[i % yesPrices.length];
    const noPrice = Math.round((1 - yesPrice) * 100) / 100;
    return {
      marketId: m.id,
      yesPrice,
      noPrice,
      yesBid: Math.round((yesPrice - 0.01) * 100) / 100,
      yesAsk: Math.round((yesPrice + 0.01) * 100) / 100,
      volume: volumes[i % volumes.length],
    };
  });

  await db.insert(prices).values(priceRows);

  return c.json({ seeded: newMarkets.length });
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
