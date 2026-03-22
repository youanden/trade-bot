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
const { llmAssessorTick } = await import(
  "../../src/worker/bots/llm-assessor/strategy"
);

describe("llmAssessorTick", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;
  });

  test("returns early when env.AI is absent", async () => {
    const bot = makeMockBot({
      botType: "llm-assessor",
      platform: "polymarket",
      aiModel: "@cf/meta/llama-3-8b-instruct",
      minEdge: 0.1,
      maxPositionSize: 100,
    });
    const env = makeTestEnv(testDb);
    // env has no AI binding — strategy logs error and returns early
    await expect(
      llmAssessorTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle with mock AI binding when no markets available", async () => {
    // mockClient.getMarkets() returns [] — no markets to evaluate
    // strategy runs through the empty loop cleanly
    const bot = makeMockBot({
      botType: "llm-assessor",
      platform: "polymarket",
      aiModel: "@cf/meta/llama-3-8b-instruct",
      minEdge: 0.1,
      maxPositionSize: 100,
    });
    const env = makeTestEnv(testDb);
    (env as any).AI = mockAI;
    await expect(
      llmAssessorTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });

  test("completes tick cycle with mock AI binding and a seeded market", async () => {
    // Provide a market — mockAI returns probability 0.6 vs price 0.5 → edge 0.1
    // Strategy will attempt to trade via mockClient
    mockClient.markets = [
      {
        platformId: "test-market-1",
        platform: "polymarket",
        title: "Will event X happen?",
        status: "active",
      },
    ];
    mockClient.priceMap = { "test-market-1": { yes: 0.5, no: 0.5 } };

    const bot = makeMockBot({
      botType: "llm-assessor",
      platform: "polymarket",
      aiModel: "@cf/meta/llama-3-8b-instruct",
      minEdge: 0.05,
      maxPositionSize: 100,
    });
    const env = makeTestEnv(testDb);
    (env as any).AI = mockAI;
    await expect(
      llmAssessorTick(bot as any, env as any)
    ).resolves.toBeUndefined();
  });
});
