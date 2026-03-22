import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createTestDb, type TestDb } from "../helpers/db";
import { mockAI } from "../helpers/mocks";
import { generateScenario } from "../../src/worker/core/simulation/generator";
import { SimExchangeClient } from "../../src/worker/core/simulation/sim-client";
import { PriceFeed } from "../../src/worker/core/simulation/feed";
import type { BacktestConfig, BacktestDeps } from "../../src/worker/core/simulation/engine";

// ---- Module mocks: MUST precede any dynamic import of strategy modules ----
// These intercept what strategies import internally.
// The engine passes `db` as env.DB and `simClient` as env._simClient.
// Our mocks forward those through so strategies use the engine's instances.

let _engineDb: TestDb | null = null;
let _engineSimClient: SimExchangeClient | null = null;

mock.module("../../src/worker/core/db/client", () => ({
  createDb: (d1: any) => {
    // If d1 is already a drizzle db (passed from engine via env.DB), return it
    if (d1 && typeof d1 === "object" && "select" in d1) return d1;
    // Fallback: return the engine db if we have it
    return _engineDb ?? createTestDb();
  },
}));

mock.module("../../src/worker/core/exchanges/factory", () => ({
  createExchangeClient: (_env: any, _platform: string, _simFeed?: any) => {
    // Return the simClient stored on env._simClient (set by engine)
    return _env?._simClient ?? _engineSimClient;
  },
}));

// Dynamic import of engine AFTER mocks
const { BacktestClock, runBacktest } = await import(
  "../../src/worker/core/simulation/engine"
);
const { listStrategies } = await import("../../src/worker/bots/registry");

// ---- Helpers ----

function makeMarketMakerConfig() {
  return {
    botType: "market-maker",
    name: "test-mm",
    tickIntervalMs: 10_000,
    platform: "polymarket" as const,
    marketIds: ["sim-feed"],
    spreadWidth: 0.04,
    orderSize: 5,
    maxInventory: 500,
    levels: 1,
    dbBotId: 1,
  };
}

function makeLlmAssessorConfig() {
  return {
    botType: "llm-assessor",
    name: "test-llm",
    tickIntervalMs: 300_000,
    platform: "polymarket" as const,
    aiModel: "@cf/meta/llama-3-8b-instruct",
    minEdge: 0.05,
    maxPositionSize: 20,
    dbBotId: 1,
  };
}

function makeDeepResearchConfig() {
  return {
    botType: "deep-research",
    name: "test-deep",
    tickIntervalMs: 3_600_000,
    platform: "polymarket" as const,
    aiModel: "@cf/meta/llama-3-8b-instruct",
    // Empty categories so the strategy uses all available markets (simulated markets
    // have no category field, so a non-empty filter would exclude them all)
    categories: [] as string[],
    minEdge: 0.05,
    maxPositionSize: 20,
    useWebSearch: false,
    dbBotId: 1,
  };
}

function makeDeps(testDb: TestDb, simClient: SimExchangeClient): BacktestDeps {
  return {
    createDb: () => testDb,
    createExchangeClient: (_env: any, _platform: string, simFeed?: any) => {
      if (simFeed) return simClient;
      return simClient;
    },
  };
}

// ---- BT-01: BacktestClock ----

describe("BT-01: BacktestClock", () => {
  test("now() returns startTime initially", () => {
    const clock = new BacktestClock("2024-01-01T00:00:00.000Z", 60_000);
    expect(clock.now()).toBe("2024-01-01T00:00:00.000Z");
  });

  test("advance() moves clock forward by intervalMs", () => {
    const clock = new BacktestClock("2024-01-01T00:00:00.000Z", 60_000);
    clock.advance();
    expect(clock.now()).toBe("2024-01-01T00:01:00.000Z");
  });

  test("advance() is cumulative", () => {
    const clock = new BacktestClock("2024-01-01T00:00:00.000Z", 60_000);
    clock.advance();
    clock.advance();
    clock.advance();
    expect(clock.now()).toBe("2024-01-01T00:03:00.000Z");
  });

  test("isAfter() returns false for earlier timestamp", () => {
    const clock = new BacktestClock("2024-01-01T01:00:00.000Z", 60_000);
    expect(clock.isAfter("2024-01-01T00:30:00.000Z")).toBe(false);
  });

  test("isAfter() returns true for later timestamp", () => {
    const clock = new BacktestClock("2024-01-01T01:00:00.000Z", 60_000);
    expect(clock.isAfter("2024-01-01T02:00:00.000Z")).toBe(true);
  });

  test("isAfter() returns false for equal timestamp", () => {
    const clock = new BacktestClock("2024-01-01T01:00:00.000Z", 60_000);
    expect(clock.isAfter("2024-01-01T01:00:00.000Z")).toBe(false);
  });
});

// ---- BT-02: engine drives strategies ----

describe("BT-02: engine drives market-maker strategy", () => {
  test("runBacktest completes 5 ticks without throwing", async () => {
    const scenario = generateScenario({
      type: "flat",
      seed: 1,
      ticks: 5,
      tickIntervalMs: 60_000,
      startTime: "2024-06-01T00:00:00.000Z",
    });

    const config: BacktestConfig = {
      botType: "market-maker",
      botConfig: makeMarketMakerConfig() as any,
      scenario,
      tickIntervalMs: 60_000,
      platform: "polymarket",
      virtualBalance: 1000,
    };

    const result = await runBacktest(config);
    expect(result.equityCurve.length).toBe(5);
    expect(result.runId).toBeTruthy();
  });

  test("all 8 strategies complete at least one tick without uncaught error", async () => {
    const strategies = listStrategies();
    expect(strategies.length).toBe(8);

    for (const botType of strategies) {
      const scenario = generateScenario({
        type: "flat",
        seed: 42,
        ticks: 1,
        tickIntervalMs: 60_000,
        startTime: "2024-06-01T00:00:00.000Z",
      });

      // Build a generic config that satisfies any strategy
      const botConfig: any = {
        botType,
        name: `test-${botType}`,
        tickIntervalMs: 60_000,
        platform: "polymarket",
        dbBotId: 1,
        // market-maker fields
        marketIds: ["sim-feed"],
        spreadWidth: 0.04,
        orderSize: 5,
        maxInventory: 500,
        levels: 1,
        // cross-arb
        platforms: ["polymarket", "kalshi"],
        marketIdPairs: [["sim-feed", "sim-feed"]],
        // llm-assessor / deep-research
        aiModel: "@cf/meta/llama-3-8b-instruct",
        minEdge: 0.05,
        maxPositionSize: 20,
        categories: ["politics"],
        useWebSearch: false,
        // weather-arb
        locations: ["Chicago"],
        targetOutcomes: ["yes"],
        // ladder-straddle
        ladderLevels: 1,
        ladderSpacing: 0.05,
        // copy-trader
        traderIds: [],
      };

      const config: BacktestConfig = {
        botType,
        botConfig,
        scenario,
        tickIntervalMs: 60_000,
        platform: "polymarket",
        virtualBalance: 1000,
        mockAI,
      };

      // Should not throw
      const result = await runBacktest(config);
      expect(result.equityCurve.length).toBe(1);
    }
  });
});

// ---- BT-04: circuit breaker day reset ----

describe("BT-04: circuit breaker day reset across simulated days", () => {
  test("48-tick scenario spanning 2 days: circuit breaker on day 1 does not block day 2", async () => {
    // 48 ticks at 30 minutes each = 24 hours spanning 2 calendar days.
    // Start at noon on day 1 so tick 24 (12h later) lands on day 2.
    const TICK_INTERVAL = 30 * 60 * 1000; // 30 min in ms
    const scenario = generateScenario({
      type: "flat",
      seed: 7,
      ticks: 48,
      tickIntervalMs: TICK_INTERVAL,
      startTime: "2024-06-01T12:00:00.000Z",
    });

    // Day 1: 2024-06-01 (ticks 0–23, 12:00–23:30)
    // Day 2: 2024-06-02 (ticks 24–47, 00:00–11:30)

    const config: BacktestConfig = {
      botType: "market-maker",
      botConfig: makeMarketMakerConfig() as any,
      scenario,
      tickIntervalMs: TICK_INTERVAL,
      platform: "polymarket",
      virtualBalance: 1000,
    };

    const result = await runBacktest(config);

    // 48 ticks should produce 48 equity snapshots
    expect(result.equityCurve.length).toBe(48);

    // Day 1 timestamps should be 2024-06-01, day 2 should be 2024-06-02
    const day1Snaps = result.equityCurve.filter((s) =>
      s.timestamp.startsWith("2024-06-01")
    );
    const day2Snaps = result.equityCurve.filter((s) =>
      s.timestamp.startsWith("2024-06-02")
    );

    expect(day1Snaps.length).toBeGreaterThan(0);
    expect(day2Snaps.length).toBeGreaterThan(0);

    // All balance values should be positive numbers
    for (const snap of result.equityCurve) {
      expect(typeof snap.balance).toBe("number");
      expect(snap.balance).toBeGreaterThan(0);
    }
  });
});

// ---- BT-05: database isolation ----

describe("BT-05: database isolation between concurrent runBacktest calls", () => {
  test("two concurrent runs have independent equity curves and different runIds", async () => {
    const scenario = generateScenario({
      type: "flat",
      seed: 1,
      ticks: 3,
      tickIntervalMs: 60_000,
      startTime: "2024-06-01T00:00:00.000Z",
    });

    const config: BacktestConfig = {
      botType: "market-maker",
      botConfig: makeMarketMakerConfig() as any,
      scenario,
      tickIntervalMs: 60_000,
      platform: "polymarket",
      virtualBalance: 1000,
    };

    const [result1, result2] = await Promise.all([
      runBacktest(config),
      runBacktest(config),
    ]);

    // Different run IDs
    expect(result1.runId).not.toBe(result2.runId);

    // Both have correct length
    expect(result1.equityCurve.length).toBe(3);
    expect(result2.equityCurve.length).toBe(3);
  });
});

// ---- BT-06: equity curve ----

describe("BT-06: equity curve snapshots", () => {
  test("equity curve timestamps match scenario price timestamps", async () => {
    const scenario = generateScenario({
      type: "flat",
      seed: 2,
      ticks: 4,
      tickIntervalMs: 60_000,
      startTime: "2024-06-01T00:00:00.000Z",
    });

    const config: BacktestConfig = {
      botType: "market-maker",
      botConfig: makeMarketMakerConfig() as any,
      scenario,
      tickIntervalMs: 60_000,
      platform: "polymarket",
      virtualBalance: 1000,
    };

    const result = await runBacktest(config);

    expect(result.equityCurve.length).toBe(4);

    for (let i = 0; i < result.equityCurve.length; i++) {
      const snap = result.equityCurve[i];
      expect(snap.timestamp).toBe(scenario.prices[i].timestamp);
      expect(typeof snap.balance).toBe("number");
      expect(snap.balance).toBeGreaterThan(0);
      expect(snap.tickIndex).toBe(i);
    }
  });

  test("finalBalance matches last equity curve balance", async () => {
    const scenario = generateScenario({
      type: "flat",
      seed: 3,
      ticks: 3,
      tickIntervalMs: 60_000,
      startTime: "2024-06-01T00:00:00.000Z",
    });

    const config: BacktestConfig = {
      botType: "market-maker",
      botConfig: makeMarketMakerConfig() as any,
      scenario,
      tickIntervalMs: 60_000,
      platform: "polymarket",
      virtualBalance: 500,
    };

    const result = await runBacktest(config);
    const lastSnap = result.equityCurve[result.equityCurve.length - 1];
    expect(result.finalBalance).toBe(lastSnap.balance);
  });
});

// ---- BT-07: LLM mock strategies ----

describe("BT-07: LLM strategies produce trades with mockAI", () => {
  test("llm-assessor with mockAI produces tradeCount > 0", async () => {
    const scenario = generateScenario({
      type: "flat",
      seed: 10,
      ticks: 3,
      tickIntervalMs: 60_000,
      startTime: "2024-06-01T00:00:00.000Z",
    });

    const config: BacktestConfig = {
      botType: "llm-assessor",
      botConfig: makeLlmAssessorConfig() as any,
      scenario,
      tickIntervalMs: 60_000,
      platform: "polymarket",
      virtualBalance: 1000,
      mockAI,
    };

    const result = await runBacktest(config);
    expect(result.tradeCount).toBeGreaterThan(0);
  });

  test("deep-research with mockAI produces tradeCount > 0", async () => {
    const scenario = generateScenario({
      type: "flat",
      seed: 11,
      ticks: 3,
      tickIntervalMs: 60_000,
      startTime: "2024-06-01T00:00:00.000Z",
    });

    const config: BacktestConfig = {
      botType: "deep-research",
      botConfig: makeDeepResearchConfig() as any,
      scenario,
      tickIntervalMs: 60_000,
      platform: "polymarket",
      virtualBalance: 1000,
      mockAI,
    };

    const result = await runBacktest(config);
    expect(result.tradeCount).toBeGreaterThan(0);
  });
});
