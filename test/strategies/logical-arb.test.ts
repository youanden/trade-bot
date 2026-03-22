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
const { logicalArbTick } = await import(
  "../../src/worker/bots/logical-arb/strategy"
);

describe("logicalArbTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("completes tick cycle without throwing when no markets available", async () => {
    // MockExchangeClient.getMarkets() returns empty list by default
    // so no violations are detected → loop body never executes
    const bot = makeMockBot({
      botType: "logical-arb",
      platform: "polymarket",
      violationThreshold: 0.02,
      maxPositionSize: 100,
    });
    const env = makeTestEnv(testDb);
    await expect(
      logicalArbTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle without throwing when market prices are balanced", async () => {
    // Prices sum to 1.0 — below violationThreshold — no trades placed
    mockClient.markets = [
      {
        platformId: "balanced-market",
        platform: "polymarket",
        title: "Balanced Market",
        status: "active",
      },
    ];
    mockClient.priceMap = { "balanced-market": { yes: 0.5, no: 0.5 } };

    const bot = makeMockBot({
      botType: "logical-arb",
      platform: "polymarket",
      violationThreshold: 0.02,
      maxPositionSize: 100,
    });
    const env = makeTestEnv(testDb);
    await expect(
      logicalArbTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
