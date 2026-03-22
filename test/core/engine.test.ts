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
  test("circuit breaker fires on day 1 after losing positions seeded, trading resumes on day 2", async () => {
    // 48 ticks at 30min each = 24 hours, starting noon day 1.
    // Day 1: 2024-06-01 (ticks 0–23, 12:00–23:30)
    // Day 2: 2024-06-02 (ticks 24–47, 00:00–11:30)
    const TICK_INTERVAL = 30 * 60 * 1000; // 30 min
    const scenario = generateScenario({
      type: "flat",
      seed: 7,
      ticks: 48,
      tickIntervalMs: TICK_INTERVAL,
      startTime: "2024-06-01T12:00:00.000Z",
    });

    // Track circuit breaker state and trade activity per day
    let breakerFiredOnDay1 = false;
    let tradesBeforeBreaker = 0;
    let tradesOnDay2 = 0;
    let tickCount = 0;

    // Dynamic imports for types/modules used inside the custom strategy
    const { positions: positionsTable } = await import(
      "../../src/worker/core/db/schema"
    );
    const { PortfolioRisk } = await import(
      "../../src/worker/core/risk/portfolio"
    );
    const { getLimitsForBot } = await import(
      "../../src/worker/core/risk/limits"
    );

    // Create isolated DB (same as engine does)
    const db = createTestDb();

    // Seed market and bot rows so positions FK constraint is satisfied
    const { markets: marketsTable, prices: pricesTable, botInstances: botInstancesTable } = await import(
      "../../src/worker/core/db/schema"
    );

    const [insertedMarket] = db
      .insert(marketsTable)
      .values({
        platform: scenario.market.platform,
        platformId: scenario.market.platformId,
        title: scenario.market.title,
        status: scenario.market.status ?? "active",
      })
      .returning()
      .all();

    for (const priceRow of scenario.prices) {
      db.insert(pricesTable)
        .values({
          marketId: insertedMarket.id,
          yesPrice: priceRow.yesPrice,
          noPrice: priceRow.noPrice,
          timestamp: priceRow.timestamp,
        })
        .run();
    }

    const [insertedBot] = db
      .insert(botInstancesTable)
      .values({
        botType: "market-maker",
        name: "test-breaker",
        status: "running",
        config: makeMarketMakerConfig(),
      })
      .returning()
      .all();

    const botConfig = { ...makeMarketMakerConfig(), dbBotId: insertedBot.id };

    // Import engine components
    const { BacktestClock } = await import(
      "../../src/worker/core/simulation/engine"
    );
    const { SimulatedBot } = await import(
      "../../src/worker/core/simulation/sim-bot"
    );
    const { PriceFeed } = await import(
      "../../src/worker/core/simulation/feed"
    );
    const { SimExchangeClient } = await import(
      "../../src/worker/core/simulation/sim-client"
    );

    const clock = new BacktestClock("2024-06-01T12:00:00.000Z", TICK_INTERVAL);
    const feed = new PriceFeed(scenario);
    const bot = new SimulatedBot(botConfig as any, db);
    const simClient = new SimExchangeClient({
      platform: "polymarket",
      feed,
      simulatedNow: () => clock.now(),
      virtualBalance: 1000,
    });

    // env stub — passes drizzle db directly so PortfolioRisk can use it
    const env: any = {
      DB: db,
      _simClient: simClient,
      ENVIRONMENT: "backtest",
    };

    // Custom strategy: seeds a losing position on tick 3, then checks the circuit
    // breaker on each tick. Records a trade when the breaker is not fired.
    const circuitBreakerStrategy = async (
      _bot: typeof bot,
      stratEnv: typeof env
    ) => {
      tickCount++;
      const stratDb = stratEnv.DB; // drizzle DB instance

      const risk = new PortfolioRisk(
        stratDb,
        getLimitsForBot("market-maker")
        // No clockFn — defaults to () => new Date().toISOString()
        // During the loop, globalThis.Date is SimulatedDate, so this returns
        // simulated time automatically.
      );
      const now = new Date().toISOString(); // SimulatedDate → simulated time
      const today = now.split("T")[0];

      // On tick 3 (still day 1, 2024-06-01): seed a closed losing position
      // with unrealizedPnl: -600, which exceeds market-maker maxDailyLoss (500).
      if (tickCount === 3) {
        stratDb
          .insert(positionsTable)
          .values({
            botInstanceId: insertedBot.id,
            marketId: insertedMarket.id,
            platform: "polymarket",
            outcome: "yes",
            size: 100,
            avgEntry: 0.5,
            currentPrice: 0.0,
            unrealizedPnl: -600,
            status: "closed",
            closedAt: now, // 2024-06-01 in simulated time
          })
          .run();
      }

      // Check circuit breaker
      const breached = await risk.isDailyLossBreached();

      if (breached && today === "2024-06-01") {
        breakerFiredOnDay1 = true;
        return; // Skip trading — mimics real strategy behavior
      }

      // Not breached: record a trade
      await _bot.recordTrade({
        marketId: insertedMarket.id,
        platform: "polymarket",
        side: "buy",
        outcome: "yes",
        price: 0.5,
        size: 1,
        reason: `tick-${tickCount}`,
      });

      if (today === "2024-06-01" && !breached) {
        tradesBeforeBreaker++;
      }
      if (today === "2024-06-02") {
        tradesOnDay2++;
      }
    };

    // Override globalThis.Date so new Date() returns simulated time (matches engine behavior)
    const OriginalDate = globalThis.Date;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SimulatedDate: any = function SimulatedDate(this: any, ...args: any[]) {
      if (args.length === 0) return new OriginalDate(clock.now());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new OriginalDate(...(args as [any]));
    };
    SimulatedDate.now = () => new OriginalDate(clock.now()).getTime();
    SimulatedDate.parse = OriginalDate.parse.bind(OriginalDate);
    SimulatedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
    SimulatedDate.prototype = OriginalDate.prototype;

    globalThis.Date = SimulatedDate;
    try {
      for (let i = 0; i < scenario.prices.length; i++) {
        await circuitBreakerStrategy(bot, env);
        clock.advance();
      }
    } finally {
      globalThis.Date = OriginalDate;
    }

    // ASSERTIONS:

    // 1. Circuit breaker fired on day 1 after tick 3 seeded -600 PnL
    expect(breakerFiredOnDay1).toBe(true);

    // 2. Trades happened before the breaker (ticks 1-2 on day 1 before seeding)
    expect(tradesBeforeBreaker).toBeGreaterThan(0);

    // 3. Trading resumed on day 2 (breaker resets after midnight)
    expect(tradesOnDay2).toBeGreaterThan(0);

    // 4. Total recorded trades = pre-breaker + day-2 (no trades during breaker period)
    expect(bot._tradeCount).toBe(tradesBeforeBreaker + tradesOnDay2);
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
