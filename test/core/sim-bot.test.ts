import { describe, test, expect, beforeEach } from "bun:test";
import { createTestDb, type TestDb } from "../helpers/db";
import { SimulatedBot } from "../../src/worker/core/simulation/sim-bot";
import { PortfolioRisk } from "../../src/worker/core/risk/portfolio";
import { botInstances, markets, positions } from "../../src/worker/core/db/schema";
import { eq, and } from "drizzle-orm";
import type { BotConfig } from "../../src/worker/bots/base";

// ── Shared seeds ──

function seedBotAndMarket(db: TestDb): { botId: number; marketId: number } {
  const [bot] = db
    .insert(botInstances)
    .values({
      botType: "market-maker",
      name: "test-bot",
      status: "running",
    })
    .returning()
    .all();

  const [market] = db
    .insert(markets)
    .values({
      platform: "polymarket",
      platformId: "mkt-001",
      title: "Test Market",
      status: "active",
    })
    .returning()
    .all();

  return { botId: bot.id, marketId: market.id };
}

// ── SimulatedBot tests ──

describe("SimulatedBot", () => {
  let db: TestDb;
  let config: BotConfig;

  beforeEach(() => {
    db = createTestDb();
    config = {
      botType: "market-maker",
      name: "test-sim-bot",
      tickIntervalMs: 5000,
      dbBotId: 1,
    };
  });

  test("Test 1: exposes config as a public property matching BotConfig shape", () => {
    const bot = new SimulatedBot(config, db);
    expect(bot.config).toBeDefined();
    expect(bot.config.botType).toBe("market-maker");
    expect(bot.config.name).toBe("test-sim-bot");
    expect(bot.config.tickIntervalMs).toBe(5000);
  });

  test("Test 2: bot.config.botType returns the botType passed to constructor", () => {
    const customConfig: BotConfig = {
      botType: "cross-arb",
      name: "arb-bot",
      tickIntervalMs: 1000,
    };
    const bot = new SimulatedBot(customConfig, db);
    expect(bot.config.botType).toBe("cross-arb");
  });

  test("Test 3: recordTrade inserts rows into orders and trades tables", async () => {
    const { botId, marketId } = seedBotAndMarket(db);
    const botConfig: BotConfig = { ...config, dbBotId: botId };
    const bot = new SimulatedBot(botConfig, db);

    await bot.recordTrade({
      marketId,
      platform: "polymarket",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 10,
    });

    // Check orders table
    const orderRows = db
      .select()
      .from(require("../../src/worker/core/db/schema").orders)
      .where(eq(require("../../src/worker/core/db/schema").orders.botInstanceId, botId))
      .all();
    expect(orderRows.length).toBe(1);
    expect(orderRows[0].side).toBe("buy");
    expect(orderRows[0].price).toBe(0.5);
    expect(orderRows[0].size).toBe(10);

    // Check trades table
    const tradeRows = db
      .select()
      .from(require("../../src/worker/core/db/schema").trades)
      .where(eq(require("../../src/worker/core/db/schema").trades.botInstanceId, botId))
      .all();
    expect(tradeRows.length).toBe(1);
    expect(tradeRows[0].filledPrice).toBe(0.5);
    expect(tradeRows[0].filledSize).toBe(10);
  });

  test("Test 4: after recordTrade, positions table has open position with correct size and avgEntry", async () => {
    const { botId, marketId } = seedBotAndMarket(db);
    const botConfig: BotConfig = { ...config, dbBotId: botId };
    const bot = new SimulatedBot(botConfig, db);

    await bot.recordTrade({
      marketId,
      platform: "polymarket",
      side: "buy",
      outcome: "yes",
      price: 0.6,
      size: 20,
    });

    const posRows = db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.botInstanceId, botId),
          eq(positions.marketId, marketId),
          eq(positions.status, "open"),
        )
      )
      .all();

    expect(posRows.length).toBe(1);
    expect(posRows[0].size).toBe(20);
    expect(posRows[0].avgEntry).toBeCloseTo(0.6, 5);
    expect(posRows[0].outcome).toBe("yes");
  });

  test("Test 5: recordTrade returns incrementing trade count (1, 2, 3...)", async () => {
    const { botId, marketId } = seedBotAndMarket(db);
    const botConfig: BotConfig = { ...config, dbBotId: botId };
    const bot = new SimulatedBot(botConfig, db);

    const tradeData = {
      marketId,
      platform: "polymarket",
      side: "buy" as const,
      outcome: "yes" as const,
      price: 0.5,
      size: 5,
    };

    const count1 = await bot.recordTrade(tradeData);
    const count2 = await bot.recordTrade(tradeData);
    const count3 = await bot.recordTrade(tradeData);

    expect(count1).toBe(1);
    expect(count2).toBe(2);
    expect(count3).toBe(3);
  });

  test("Test 6: getStatus() returns object with botType, name, running: true", () => {
    const bot = new SimulatedBot(config, db);
    const status = bot.getStatus();
    expect(status.botType).toBe("market-maker");
    expect(status.name).toBe("test-sim-bot");
    expect(status.running).toBe(true);
    expect(status.id).toBe("sim-bot");
  });

  test("Test 7: two sell trades that close a position set status to closed", async () => {
    const { botId, marketId } = seedBotAndMarket(db);
    const botConfig: BotConfig = { ...config, dbBotId: botId };
    const bot = new SimulatedBot(botConfig, db);

    // Open position with a buy
    await bot.recordTrade({
      marketId,
      platform: "polymarket",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 10,
    });

    // Close position fully with a sell
    await bot.recordTrade({
      marketId,
      platform: "polymarket",
      side: "sell",
      outcome: "yes",
      price: 0.6,
      size: 10,
    });

    const posRows = db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.botInstanceId, botId),
          eq(positions.marketId, marketId),
        )
      )
      .all();

    expect(posRows.length).toBe(1);
    expect(posRows[0].status).toBe("closed");
    expect(posRows[0].closedAt).not.toBeNull();
  });

  test("Test 8: SimulatedBot does NOT import from cloudflare:workers", () => {
    // Grep verification — if import exists, this test would fail at import time
    // This test verifies the module loaded without cloudflare:workers dependency
    const bot = new SimulatedBot(config, db);
    expect(bot).toBeDefined();
    // The fact that this test can run in bun:test without Wrangler confirms no cloudflare:workers import
  });

  test("_tradeCount getter returns current trade count", async () => {
    const { botId, marketId } = seedBotAndMarket(db);
    const botConfig: BotConfig = { ...config, dbBotId: botId };
    const bot = new SimulatedBot(botConfig, db);

    expect(bot._tradeCount).toBe(0);
    await bot.recordTrade({
      marketId,
      platform: "polymarket",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 5,
    });
    expect(bot._tradeCount).toBe(1);
  });
});

// ── PortfolioRisk clock injection tests ──

describe("PortfolioRisk - injectable clock", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  test("PortfolioRisk without clockFn (default) returns false on empty DB", async () => {
    const risk = new PortfolioRisk(db as any);
    const breached = await risk.isDailyLossBreached();
    expect(breached).toBe(false);
  });

  test("PortfolioRisk with custom clockFn uses that date for today", async () => {
    const fixedClock = () => "2024-06-15T12:00:00.000Z";
    const risk = new PortfolioRisk(db as any, {}, fixedClock);

    // No closed positions on 2024-06-15, so not breached
    const breached = await risk.isDailyLossBreached();
    expect(breached).toBe(false);
  });

  test("isDailyLossBreached returns true when loss exceeds maxDailyLoss for given clock date", async () => {
    // Seed market and bot
    const [market] = db
      .insert(markets)
      .values({
        platform: "polymarket",
        platformId: "mkt-clock",
        title: "Clock Test Market",
        status: "active",
      })
      .returning()
      .all();

    const [bot] = db
      .insert(botInstances)
      .values({ botType: "market-maker", name: "clock-bot", status: "stopped" })
      .returning()
      .all();

    // Insert a closed position with loss on the target date
    db.insert(positions).values({
      botInstanceId: bot.id,
      marketId: market.id,
      platform: "polymarket",
      outcome: "yes",
      size: 0,
      avgEntry: 0.7,
      currentPrice: 0.1,
      unrealizedPnl: -600,
      status: "closed",
      closedAt: "2024-06-15T10:00:00.000Z",
    }).run();

    const fixedClock = () => "2024-06-15T18:00:00.000Z";
    // maxDailyLoss = 500, loss = -600 => breached
    const risk = new PortfolioRisk(db as any, { maxDailyLoss: 500 }, fixedClock);
    const breached = await risk.isDailyLossBreached();
    expect(breached).toBe(true);
  });

  test("isDailyLossBreached does not count loss from a different date", async () => {
    const [market] = db
      .insert(markets)
      .values({
        platform: "polymarket",
        platformId: "mkt-clock2",
        title: "Clock Test Market 2",
        status: "active",
      })
      .returning()
      .all();

    const [bot] = db
      .insert(botInstances)
      .values({ botType: "market-maker", name: "clock-bot2", status: "stopped" })
      .returning()
      .all();

    // Insert a closed position with loss on a DIFFERENT date
    db.insert(positions).values({
      botInstanceId: bot.id,
      marketId: market.id,
      platform: "polymarket",
      outcome: "yes",
      size: 0,
      avgEntry: 0.7,
      currentPrice: 0.1,
      unrealizedPnl: -600,
      status: "closed",
      closedAt: "2024-06-14T10:00:00.000Z", // yesterday
    }).run();

    const fixedClock = () => "2024-06-15T18:00:00.000Z"; // today
    const risk = new PortfolioRisk(db as any, { maxDailyLoss: 500 }, fixedClock);
    // Loss is from yesterday, should not count
    const breached = await risk.isDailyLossBreached();
    expect(breached).toBe(false);
  });
});
