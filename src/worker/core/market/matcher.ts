import type { Database } from "../db/client";
import { markets, marketLinks } from "../db/schema";
import { eq, and, ne } from "drizzle-orm";
import { Logger } from "../utils/logger";
import type { UnifiedMarket, MarketMatch } from "./types";

const log = new Logger({ module: "market-matcher" });

/**
 * Cross-platform market matcher — finds the same event
 * listed on both Polymarket and Kalshi.
 */
export class MarketMatcher {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Find matching markets across platforms using title similarity.
   * Returns pairs with a confidence score.
   */
  async findMatches(minConfidence = 0.6): Promise<MarketMatch[]> {
    // Get active markets grouped by platform
    const allMarkets = await this.db
      .select()
      .from(markets)
      .where(eq(markets.status, "active"));

    const polymarkets = allMarkets.filter((m) => m.platform === "polymarket");
    const kalshiMarkets = allMarkets.filter((m) => m.platform === "kalshi");

    const matches: MarketMatch[] = [];

    for (const pm of polymarkets) {
      for (const km of kalshiMarkets) {
        const confidence = this.titleSimilarity(pm.title, km.title);
        if (confidence >= minConfidence) {
          matches.push({
            marketA: this.toUnified(pm),
            marketB: this.toUnified(km),
            confidence,
            matchMethod: "title",
          });
        }
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);

    log.info("match:complete", {
      polymarkets: polymarkets.length,
      kalshi: kalshiMarkets.length,
      matches: matches.length,
    });

    return matches;
  }

  /** Save a confirmed match to the market_links table. */
  async saveMatch(
    marketIdA: number,
    marketIdB: number,
    confidence: number,
    method: "title" | "manual" | "llm" = "title"
  ): Promise<void> {
    await this.db.insert(marketLinks).values({
      marketIdA,
      marketIdB,
      confidence,
      matchMethod: method,
    });
    log.info("match:saved", { marketIdA, marketIdB, confidence });
  }

  /** Get linked markets for a given market ID. */
  async getLinkedMarkets(
    marketId: number
  ): Promise<Array<typeof markets.$inferSelect>> {
    const links = await this.db
      .select()
      .from(marketLinks)
      .where(eq(marketLinks.marketIdA, marketId));

    const linksB = await this.db
      .select()
      .from(marketLinks)
      .where(eq(marketLinks.marketIdB, marketId));

    const linkedIds = [
      ...links.map((l) => l.marketIdB),
      ...linksB.map((l) => l.marketIdA),
    ];

    if (linkedIds.length === 0) return [];

    const results = [];
    for (const id of linkedIds) {
      const [m] = await this.db
        .select()
        .from(markets)
        .where(eq(markets.id, id));
      if (m) results.push(m);
    }
    return results;
  }

  // ── Title similarity ──

  /**
   * Compute similarity between two market titles.
   * Uses normalized token overlap (Jaccard-like).
   */
  private titleSimilarity(a: string, b: string): number {
    const tokensA = this.tokenize(a);
    const tokensB = this.tokenize(b);

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    const union = new Set([...tokensA, ...tokensB]).size;
    return intersection / union;
  }

  private tokenize(text: string): Set<string> {
    // Remove noise words, normalize
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "in",
      "on",
      "at",
      "to",
      "of",
      "by",
      "for",
      "will",
      "be",
      "is",
      "are",
      "was",
      "were",
      "has",
      "have",
      "do",
      "does",
      "did",
      "this",
      "that",
      "it",
      "or",
      "and",
      "if",
      "than",
    ]);

    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !stopWords.has(w))
    );
  }

  private toUnified(
    m: typeof markets.$inferSelect
  ): UnifiedMarket {
    return {
      id: m.id,
      platform: m.platform as "polymarket" | "kalshi",
      platformId: m.platformId,
      title: m.title,
      category: m.category ?? undefined,
    };
  }
}
