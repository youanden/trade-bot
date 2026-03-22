import { describe, test, expect } from "bun:test";
import { generateScenario } from "../../src/worker/core/simulation/generator";
import { PriceFeed } from "../../src/worker/core/simulation/feed";

describe("PriceFeed cursor — no-lookahead enforcement", () => {
  const scenario = generateScenario({
    type: "bull",
    seed: 42,
    ticks: 100,
  });

  const feed = new PriceFeed(scenario);

  test("returns exactly K rows when cutoff is at row K timestamp", () => {
    const cutoff = scenario.prices[9].timestamp;
    const rows = feed.getUpTo(cutoff);
    expect(rows.length).toBe(10);
  });

  test("returns empty when simulatedNow is before all data", () => {
    const beforeAll = "1970-01-01T00:00:00.000Z";
    const rows = feed.getUpTo(beforeAll);
    expect(rows.length).toBe(0);
  });

  test("returns all rows when simulatedNow is after all data", () => {
    const afterAll = "2099-01-01T00:00:00.000Z";
    const rows = feed.getUpTo(afterAll);
    expect(rows.length).toBe(100);
  });

  test("no returned row has timestamp > simulatedNow", () => {
    const cutoff = scenario.prices[9].timestamp;
    const rows = feed.getUpTo(cutoff);
    expect(rows.every((r) => r.timestamp <= cutoff)).toBe(true);
  });

  test("latestAt returns last visible row", () => {
    const cutoff = scenario.prices[9].timestamp;
    const latest = feed.latestAt(cutoff);
    expect(latest).toEqual(scenario.prices[9]);
  });

  test("latestAt returns undefined before all data", () => {
    const beforeAll = "1970-01-01T00:00:00.000Z";
    const latest = feed.latestAt(beforeAll);
    expect(latest).toBeUndefined();
  });
});
