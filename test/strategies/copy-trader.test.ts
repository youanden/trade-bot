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
const { copyTraderTick } = await import(
  "../../src/worker/bots/copy-trader/strategy"
);

describe("copyTraderTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("completes tick cycle without throwing when traderIds is absent", async () => {
    // No traderIds — strategy returns early cleanly
    const bot = makeMockBot({ botType: "copy-trader", platform: "polymarket" });
    const env = makeTestEnv(testDb);
    await expect(
      copyTraderTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle without throwing when traderIds is empty", async () => {
    const bot = makeMockBot({
      botType: "copy-trader",
      platform: "polymarket",
      traderIds: [],
    });
    const env = makeTestEnv(testDb);
    await expect(
      copyTraderTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
