import { describe, test, expect } from "bun:test";
import { generateScenario } from "../../src/worker/core/simulation/generator";
import { createTestDb } from "../helpers/db";
import { markets, prices } from "../../src/worker/core/db/schema";

// Helper: compute standard deviation of an array
function stddev(arr: number[]): number {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

describe("DATA-07 reproducibility", () => {
  test("same seed produces identical price arrays on every invocation", () => {
    const params = { type: "bull" as const, seed: 42, ticks: 200 };
    const a = generateScenario(params);
    const b = generateScenario(params);
    expect(a.prices.map((p) => p.yesPrice)).toEqual(
      b.prices.map((p) => p.yesPrice),
    );
  });
});

describe("DATA-01 bull scenario", () => {
  test("last yes_price > start price (0.5) with seed 42, 200 ticks", () => {
    const scenario = generateScenario({ type: "bull", seed: 42, ticks: 200 });
    const lastPrice = scenario.prices[scenario.prices.length - 1].yesPrice;
    expect(lastPrice).toBeGreaterThan(0.5);
  });
});

describe("DATA-02 bear scenario", () => {
  test("last yes_price < start price (0.5) with seed 42, 200 ticks", () => {
    const scenario = generateScenario({ type: "bear", seed: 42, ticks: 200 });
    const lastPrice = scenario.prices[scenario.prices.length - 1].yesPrice;
    expect(lastPrice).toBeLessThan(0.5);
  });
});

describe("DATA-03 flat scenario", () => {
  test("all prices within 0.15 of start price (0.5) with seed 42, 200 ticks", () => {
    const scenario = generateScenario({ type: "flat", seed: 42, ticks: 200 });
    for (const p of scenario.prices) {
      expect(Math.abs(p.yesPrice - 0.5)).toBeLessThan(0.15);
    }
  });
});

describe("DATA-04 volatile scenario", () => {
  test("standard deviation of yes_price > 0.08 with seed 42, 200 ticks", () => {
    const scenario = generateScenario({
      type: "volatile",
      seed: 42,
      ticks: 200,
    });
    const sd = stddev(scenario.prices.map((p) => p.yesPrice));
    expect(sd).toBeGreaterThan(0.08);
  });
});

describe("DATA-05 crash scenario", () => {
  test("price at 60% mark > final price (reversal occurred) with seed 42, 200 ticks", () => {
    const ticks = 200;
    const scenario = generateScenario({
      type: "crash",
      seed: 42,
      ticks,
    });
    const crashIdx = Math.floor(ticks * 0.6);
    const priceAtCrash = scenario.prices[crashIdx].yesPrice;
    const lastPrice = scenario.prices[scenario.prices.length - 1].yesPrice;
    expect(priceAtCrash).toBeGreaterThan(lastPrice);
  });
});

describe("DATA-06 schema conformance", () => {
  test("market row inserts into markets table without error", () => {
    const db = createTestDb();
    const scenario = generateScenario({ type: "bull", seed: 1, ticks: 10 });

    const [inserted] = db
      .insert(markets)
      .values(scenario.market)
      .returning({ id: markets.id })
      .all();

    expect(inserted.id).toBeGreaterThan(0);
  });

  test("price rows insert into prices table with resolved market_id without error", () => {
    const db = createTestDb();
    const scenario = generateScenario({ type: "bull", seed: 1, ticks: 10 });

    const [inserted] = db
      .insert(markets)
      .values(scenario.market)
      .returning({ id: markets.id })
      .all();

    const priceRows = scenario.prices.map((p) => ({
      ...p,
      marketId: inserted.id,
    }));

    // insert returns a Drizzle result; run() executes synchronously
    const result = db.insert(prices).values(priceRows).run();
    expect(result).toBeDefined();
  });
});

describe("price bounds", () => {
  test("every yes_price is in [0.01, 0.99] across all scenario types", () => {
    const types = ["bull", "bear", "flat", "volatile", "crash"] as const;
    for (const type of types) {
      const scenario = generateScenario({ type, seed: 42, ticks: 200 });
      for (const p of scenario.prices) {
        expect(p.yesPrice).toBeGreaterThanOrEqual(0.01);
        expect(p.yesPrice).toBeLessThanOrEqual(0.99);
      }
    }
  });

  test("no_price is approximately 1 - yes_price within 0.05 tolerance", () => {
    const scenario = generateScenario({ type: "bull", seed: 42, ticks: 200 });
    for (const p of scenario.prices) {
      expect(Math.abs(p.noPrice - (1 - p.yesPrice))).toBeLessThan(0.05);
    }
  });
});

describe("timestamp format", () => {
  test("all price timestamps match ISO-8601 pattern", () => {
    const scenario = generateScenario({ type: "bull", seed: 42, ticks: 50 });
    const iso8601 = /^\d{4}-\d{2}-\d{2}T/;
    for (const p of scenario.prices) {
      expect(p.timestamp).toMatch(iso8601);
    }
  });
});

describe("market row fields", () => {
  test("market row has required fields with correct values", () => {
    const scenario = generateScenario({ type: "bull", seed: 42, ticks: 10 });
    expect(scenario.market.platform).toBe("polymarket");
    expect(typeof scenario.market.platformId).toBe("string");
    expect(typeof scenario.market.title).toBe("string");
    expect(scenario.market.status).toBe("active");
  });
});
