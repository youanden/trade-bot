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
const { ladderStraddleTick } = await import(
  "../../src/worker/bots/ladder-straddle/strategy"
);

describe("ladderStraddleTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("completes tick cycle without throwing when marketId is absent", async () => {
    // No marketId configured — strategy returns early cleanly
    const bot = makeMockBot({
      botType: "ladder-straddle",
      platform: "polymarket",
    });
    const env = makeTestEnv(testDb);
    await expect(
      ladderStraddleTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle without throwing when marketId is provided", async () => {
    // marketId set — will initialize ladder and place orders via mockClient
    const bot = makeMockBot({
      botType: "ladder-straddle",
      platform: "polymarket",
      marketId: "test-market-1",
      priceLevels: [0.4, 0.5, 0.6],
      sizePerLevel: 10,
      takeProfit: 0.1,
    });
    const env = makeTestEnv(testDb);
    await expect(
      ladderStraddleTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
