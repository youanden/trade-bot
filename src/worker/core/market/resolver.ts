import type { ExchangeClient, MarketInfo } from "../exchanges/types";
import type { Database } from "../db/client";
import { markets } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { Logger } from "../utils/logger";

const log = new Logger({ module: "market-resolver" });

/**
 * Unified market discovery — fetches markets from exchanges
 * and upserts into D1 for local querying.
 */
export class MarketResolver {
  private clients: ExchangeClient[];
  private db: Database;

  constructor(db: Database, clients: ExchangeClient[]) {
    this.db = db;
    this.clients = clients;
  }

  /** Fetch markets from all exchanges and sync to D1. */
  async syncMarkets(limit = 100): Promise<number> {
    let total = 0;

    for (const client of this.clients) {
      try {
        const { markets: fetched } = await client.getMarkets({ limit });
        for (const m of fetched) {
          await this.upsertMarket(m);
          total++;
        }
        log.info("sync:done", { platform: client.platform, count: fetched.length });
      } catch (err) {
        log.error("sync:error", {
          platform: client.platform,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return total;
  }

  /** Get a market from D1 by platform and platform ID. */
  async getMarket(
    platform: string,
    platformId: string
  ): Promise<typeof markets.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.platform, platform),
          eq(markets.platformId, platformId)
        )
      );
    return row ?? null;
  }

  /** Search markets by title substring. */
  async searchMarkets(query: string, limit = 50) {
    // D1 supports LIKE for basic text search
    const rows = await this.db
      .select()
      .from(markets)
      .where(eq(markets.status, "active"))
      .limit(limit);

    const q = query.toLowerCase();
    return rows.filter((r) => r.title.toLowerCase().includes(q));
  }

  private async upsertMarket(m: MarketInfo): Promise<void> {
    const existing = await this.getMarket(m.platform, m.platformId);

    if (existing) {
      await this.db
        .update(markets)
        .set({
          title: m.title,
          description: m.description,
          category: m.category,
          status: m.status,
          endDate: m.endDate,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(markets.id, existing.id));
    } else {
      await this.db.insert(markets).values({
        platform: m.platform,
        platformId: m.platformId,
        title: m.title,
        description: m.description,
        category: m.category,
        status: m.status,
        endDate: m.endDate,
      });
    }
  }
}
