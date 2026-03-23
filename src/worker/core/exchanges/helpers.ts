/**
 * Exchange helpers — DB market resolution and upsert utilities.
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "../db/client";
import { markets } from "../db/schema";
import type { MarketInfo } from "./types";

/**
 * Resolve a platform + platformId pair to a DB markets.id.
 * Returns null if the market doesn't exist in the database.
 */
export async function resolveMarketId(
  db: Database,
  platform: string,
  platformId: string
): Promise<number | null> {
  const [row] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      and(eq(markets.platform, platform), eq(markets.platformId, platformId))
    );
  return row?.id ?? null;
}

/**
 * Upsert a market row from exchange MarketInfo.
 * If the market already exists (by platform + platformId), updates it.
 * Otherwise, inserts a new row.
 * Returns the DB market id.
 */
export async function ensureMarket(
  db: Database,
  info: MarketInfo
): Promise<number> {
  const existing = await resolveMarketId(db, info.platform, info.platformId);

  if (existing !== null) {
    await db
      .update(markets)
      .set({
        title: info.title,
        description: info.description,
        category: info.category,
        status: info.status,
        endDate: info.endDate,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(markets.id, existing));
    return existing;
  }

  const [row] = await db
    .insert(markets)
    .values({
      platform: info.platform,
      platformId: info.platformId,
      title: info.title,
      description: info.description,
      category: info.category,
      status: info.status,
      endDate: info.endDate,
    })
    .returning();

  return row.id;
}
