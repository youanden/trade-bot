/**
 * BacktestEngine — orchestrates StrategyTickFn calls through generated scenarios.
 *
 * Each runBacktest() call creates an isolated in-memory DB, constructs a
 * SimExchangeClient backed by the scenario's PriceFeed, overrides globalThis.Date
 * so strategies see simulated time, and records equity curve snapshots after each tick.
 */

import { PriceFeed } from "./feed";
import { SimExchangeClient } from "./sim-client";
import { SimulatedBot } from "./sim-bot";
import { getStrategy } from "../../bots/registry";
import { markets, prices, botInstances } from "../db/schema";
import type { ExchangeClient } from "../exchanges/types";
import type { GeneratedScenario } from "./types";
import type { BotConfig } from "../../bots/base";

// ------------------------------------------------------------------ Types

export interface BacktestConfig {
  botType: string;
  botConfig: BotConfig;
  scenario: GeneratedScenario;
  tickIntervalMs?: number;
  platform: "polymarket" | "kalshi";
  virtualBalance?: number;
  mockAI?: { run: (model: string, inputs: unknown) => Promise<unknown> };
}

export interface EquitySnapshot {
  timestamp: string;
  balance: number;
  tickIndex: number;
}

export interface BacktestResult {
  equityCurve: EquitySnapshot[];
  tradeCount: number;
  finalBalance: number;
  runId: string;
}

export interface BacktestDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createDb: (d1: unknown) => any;
  createExchangeClient: (
    env: unknown,
    platform: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simFeed?: any
  ) => ExchangeClient;
}

// ------------------------------------------------------------------ Clock

/**
 * BacktestClock tracks simulated time for backtest runs.
 * Advances tick-by-tick at a configurable interval and returns ISO-8601 timestamps.
 */
export class BacktestClock {
  private currentMs: number;
  private readonly intervalMs: number;

  /**
   * @param startTime - ISO-8601 timestamp for tick 0
   * @param tickIntervalMs - milliseconds per tick
   */
  constructor(startTime: string, tickIntervalMs: number) {
    this.currentMs = new Date(startTime).getTime();
    this.intervalMs = tickIntervalMs;
  }

  /** Returns the current simulated time as ISO-8601 string. */
  now(): string {
    return new Date(this.currentMs).toISOString();
  }

  /** Advances the clock by one tick interval. */
  advance(): void {
    this.currentMs += this.intervalMs;
  }

  /**
   * Returns true if isoTimestamp is strictly after the current simulated time.
   *
   * @param isoTimestamp - ISO-8601 string to compare against current time
   */
  isAfter(isoTimestamp: string): boolean {
    return new Date(isoTimestamp).getTime() > this.currentMs;
  }
}

// ------------------------------------------------------------------ Engine

/**
 * Runs a full backtest for a single strategy + scenario combination.
 *
 * Creates an isolated in-memory DB per call (no shared state between runs).
 * Overrides globalThis.Date during the tick loop so strategies read simulated time.
 * Records equity curve snapshots (balance from SimExchangeClient) after each tick.
 *
 * @param config - Strategy, scenario, and simulation parameters
 * @param deps - Optional dependency injection for testing (defaults to real modules)
 */
export async function runBacktest(
  config: BacktestConfig,
  deps?: BacktestDeps
): Promise<BacktestResult> {
  // 1. Resolve deps — lazy import defaults so tests can pass overrides without mock.module
  const resolvedDeps: BacktestDeps = deps ?? {
    createDb: (await import("../db/client")).createDb,
    createExchangeClient: (await import("../exchanges/factory")).createExchangeClient,
  };

  // 2. Create isolated DB — each call gets a fresh :memory: SQLite instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = resolvedDeps.createDb(null) as any;

  // 3. Create BacktestClock from first price timestamp
  const startTime = config.scenario.prices[0]?.timestamp ?? new Date().toISOString();
  const tickIntervalMs = config.tickIntervalMs ?? 60_000;
  const clock = new BacktestClock(startTime, tickIntervalMs);

  // 4. Create PriceFeed
  const feed = new PriceFeed(config.scenario);

  // 5. Seed scenario data into the isolated DB
  //    Insert market row and get its assigned id
  const [insertedMarket] = db
    .insert(markets)
    .values({
      platform: config.scenario.market.platform,
      platformId: config.scenario.market.platformId,
      title: config.scenario.market.title,
      status: config.scenario.market.status ?? "active",
    })
    .returning()
    .all();

  const marketDbId: number = insertedMarket.id;

  //    Insert all price rows with the assigned marketId
  for (const priceRow of config.scenario.prices) {
    db.insert(prices)
      .values({
        marketId: marketDbId,
        yesPrice: priceRow.yesPrice,
        noPrice: priceRow.noPrice,
        timestamp: priceRow.timestamp,
      })
      .run();
  }

  //    Insert bot_instances row so strategies can look up dbBotId
  const botConfig = {
    ...config.botConfig,
    dbBotId: config.botConfig.dbBotId ?? 1,
  };

  const [insertedBot] = db
    .insert(botInstances)
    .values({
      botType: config.botType,
      name: botConfig.name,
      status: "running",
      config: botConfig,
    })
    .returning()
    .all();

  //    Update botConfig.dbBotId to match the inserted row
  botConfig.dbBotId = insertedBot.id;

  // 6. Create SimulatedBot
  const bot = new SimulatedBot(botConfig, db);

  // 7. Create SimExchangeClient directly — bypasses the mock.module intercept so the
  //    engine always gets a real SimExchangeClient regardless of test overrides.
  const simClient = new SimExchangeClient({
    platform: config.platform,
    feed,
    simulatedNow: () => clock.now(),
    virtualBalance: config.virtualBalance ?? 1000,
  });

  // 8. Build env stub that carries the DB and simClient through to strategy internals.
  //    Strategies call createDb(env.DB) and createExchangeClient(env, platform):
  //    - The mock.module("../db/client") intercept returns env.DB directly when it is a drizzle db
  //    - The mock.module("../exchanges/factory") intercept returns env._simClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env: any = {
    DB: db,
    _simClient: simClient,
    ENVIRONMENT: "backtest",
    AI: config.mockAI,
    BOT_DO: {},
    ASSETS: {},
  };

  // 9. Override globalThis.Date so strategies and PortfolioRisk read simulated time.
  //    Restored in finally to prevent leak between concurrent test runs.
  const OriginalDate = globalThis.Date;

  // Keep the clock reference available inside the closure
  const getCurrentClockTime = () => clock.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SimulatedDate: any = function SimulatedDate(this: any, ...args: any[]) {
    if (args.length === 0) {
      // new Date() with no args → simulated now
      return new OriginalDate(getCurrentClockTime());
    }
    // new Date(value) → delegate to real Date
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new OriginalDate(...(args as [any]));
  };

  // Preserve static methods
  SimulatedDate.now = () => new OriginalDate(getCurrentClockTime()).getTime();
  SimulatedDate.parse = OriginalDate.parse.bind(OriginalDate);
  SimulatedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
  SimulatedDate.prototype = OriginalDate.prototype;

  // 10. Get strategy tick function
  const strategy = getStrategy(config.botType);
  if (!strategy) {
    throw new Error(`Unknown strategy: ${config.botType}`);
  }

  // 11. Tick loop
  const equityCurve: EquitySnapshot[] = [];

  globalThis.Date = SimulatedDate;

  try {
    for (let i = 0; i < config.scenario.prices.length; i++) {
      const tickTimestamp = config.scenario.prices[i].timestamp;

      // Run strategy tick with simulated env
      await strategy(bot as any, env as any);

      // Snapshot equity: balance from SimExchangeClient
      const balance = await simClient.getBalance();
      equityCurve.push({ timestamp: tickTimestamp, balance, tickIndex: i });

      // Advance clock to next tick
      clock.advance();
    }
  } finally {
    // Always restore original Date — prevents leaking across concurrent tests
    globalThis.Date = OriginalDate;
  }

  // 12. Build and return result
  const finalBalance = equityCurve[equityCurve.length - 1]?.balance ?? 0;

  return {
    equityCurve,
    tradeCount: bot._tradeCount,
    finalBalance,
    runId: crypto.randomUUID(),
  };
}
