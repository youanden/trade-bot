import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createTestDb, type TestDb } from "../helpers/db";
import { makeMockBot, makeTestEnv, MockExchangeClient } from "../helpers/mocks";

let testDb: TestDb;
const mockClient = new MockExchangeClient();

// Module mocks BEFORE dynamic import
mock.module("../../src/worker/core/db/client", () => ({
  createDb: () => testDb,
}));

mock.module("../../src/worker/core/exchanges/factory", () => ({
  createExchangeClient: () => mockClient,
}));

// Dynamic import AFTER mocks
const { marketMakerTick } = await import(
  "../../src/worker/bots/market-maker/strategy"
);

describe("marketMakerTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("completes tick cycle without throwing when marketIds is absent", async () => {
    // No marketIds configured — strategy returns early cleanly
    const bot = makeMockBot({
      botType: "market-maker",
      platform: "polymarket",
    });
    const env = makeTestEnv(testDb);
    await expect(
      marketMakerTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle without throwing when marketIds is empty", async () => {
    const bot = makeMockBot({
      botType: "market-maker",
      platform: "polymarket",
      marketIds: [],
    });
    const env = makeTestEnv(testDb);
    await expect(
      marketMakerTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle without throwing when making a market", async () => {
    // Provide a valid market — strategy will place bid/ask orders via mockClient
    const bot = makeMockBot({
      botType: "market-maker",
      platform: "polymarket",
      marketIds: ["test-market-1"],
      spreadWidth: 0.04,
      orderSize: 10,
      maxInventory: 100,
      levels: 2,
    });
    const env = makeTestEnv(testDb);
    await expect(
      marketMakerTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
