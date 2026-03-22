import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createTestDb, type TestDb } from "../helpers/db";
import {
  makeMockBot,
  makeTestEnv,
  MockExchangeClient,
  mockAI,
} from "../helpers/mocks";

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
const { deepResearchTick } = await import(
  "../../src/worker/bots/deep-research/strategy"
);

describe("deepResearchTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("returns early when env.AI is absent", async () => {
    const bot = makeMockBot({
      botType: "deep-research",
      platform: "polymarket",
      aiModel: "@cf/meta/llama-3-8b-instruct",
      categories: [],
      minEdge: 0.1,
      maxPositionSize: 200,
    });
    const env = makeTestEnv(testDb);
    // env has no AI binding — strategy logs error and returns early
    await expect(
      deepResearchTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle with mock AI binding when no markets available", async () => {
    // mockClient.getMarkets() returns [] — empty filtered list
    // strategy runs through the empty loop cleanly (0 AI calls)
    const bot = makeMockBot({
      botType: "deep-research",
      platform: "polymarket",
      aiModel: "@cf/meta/llama-3-8b-instruct",
      categories: [],
      minEdge: 0.1,
      maxPositionSize: 200,
    });
    const env = makeTestEnv(testDb);
    (env as any).AI = mockAI;
    await expect(
      deepResearchTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes 3-step AI research cycle with mock AI and a seeded market", async () => {
    // Deep-research makes 3 AI calls per market (assess, critique, finalize).
    // mockAI returns { probability: 0.6 } for all 3 calls.
    // parseProbability in deep-research also looks for "final_probability" and
    // "adjusted_probability" — our mockAI response includes "probability" as fallback.
    mockClient.markets = [
      {
        platformId: "deep-research-market-1",
        platform: "polymarket",
        title: "Will the project succeed?",
        status: "active",
      },
    ];
    mockClient.priceMap = {
      "deep-research-market-1": { yes: 0.4, no: 0.6 },
    };

    const bot = makeMockBot({
      botType: "deep-research",
      platform: "polymarket",
      aiModel: "@cf/meta/llama-3-8b-instruct",
      categories: [],
      minEdge: 0.05,
      maxPositionSize: 200,
    });
    const env = makeTestEnv(testDb);
    (env as any).AI = mockAI;
    await expect(
      deepResearchTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
