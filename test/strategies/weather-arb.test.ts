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
const { weatherArbTick } = await import(
  "../../src/worker/bots/weather-arb/strategy"
);

describe("weatherArbTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("completes tick cycle without throwing when locations is empty", async () => {
    // No locations configured — inner loop never executes
    const bot = makeMockBot({
      botType: "weather-arb",
      platform: "kalshi",
      locations: [],
      minEdge: 0.08,
      maxPositionSize: 150,
    });
    const env = makeTestEnv(testDb);
    await expect(
      weatherArbTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle without throwing when NWS forecast is unavailable", async () => {
    // Real NWS fetch will fail in test environment (no network mock) —
    // strategy catches the error and returns early per location
    const bot = makeMockBot({
      botType: "weather-arb",
      platform: "kalshi",
      locations: ["Chicago"],
      minEdge: 0.08,
      maxPositionSize: 150,
    });
    const env = makeTestEnv(testDb);
    await expect(
      weatherArbTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
