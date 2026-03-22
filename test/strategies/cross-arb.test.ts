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
const { crossArbTick } = await import(
  "../../src/worker/bots/cross-arb/strategy"
);

describe("crossArbTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("completes tick cycle without throwing when platforms array is empty", async () => {
    // With no platforms, clients.size < 2 → early return
    const bot = makeMockBot({
      botType: "cross-arb",
      platforms: [],
      minSpread: 0.05,
      maxPositionSize: 100,
    });
    const env = makeTestEnv(testDb);
    await expect(
      crossArbTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle without throwing when no linked markets exist", async () => {
    // Two platforms configured, mock returns a client for both
    // but no market_links in DB → loop body never executes
    const bot = makeMockBot({
      botType: "cross-arb",
      platforms: ["polymarket", "kalshi"],
      minSpread: 0.05,
      maxPositionSize: 100,
    });
    const env = makeTestEnv(testDb);
    await expect(
      crossArbTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
