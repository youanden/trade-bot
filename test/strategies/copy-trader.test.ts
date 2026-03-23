import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { createTestDb, type TestDb } from "../helpers/db";
import { makeMockBot, makeTestEnv, MockExchangeClient } from "../helpers/mocks";
import { trackedTraders } from "../../src/worker/core/db/schema";

let testDb: TestDb;
const mockClient = new MockExchangeClient();

// Fetch spy — tracks all outgoing fetch calls during tests
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const origFetch = globalThis.fetch;

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

    // Reset fetch spy
    fetchCalls = [];
    globalThis.fetch = async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      fetchCalls.push({ url, init });

      // Mock leaderboard API
      if (url.includes("data-api.polymarket.com/v1/leaderboard")) {
        return new Response(
          JSON.stringify([
            {
              rank: "1",
              proxyWallet: "0xABC123def456",
              userName: "TopTrader",
              pnl: 50000,
              vol: 0,
            },
          ])
        );
      }
      // Mock trader positions API
      if (url.includes("data-api.polymarket.com/positions")) {
        return new Response(JSON.stringify([]));
      }
      // Mock Discord webhook
      if (url.includes("discord.com/api/webhooks")) {
        return new Response(null, { status: 204 });
      }
      return new Response("Not Found", { status: 404 });
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
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

describe("copyTraderTick — discord notifications", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;

    fetchCalls = [];
    globalThis.fetch = async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      fetchCalls.push({ url, init });

      // Mock trader positions — return a new position so a copy-buy trade fires
      if (url.includes("data-api.polymarket.com/positions")) {
        return new Response(
          JSON.stringify([
            {
              conditionId: "market-abc",
              outcome: "yes",
              size: "10",
            },
          ])
        );
      }
      // Mock Discord webhook
      if (url.includes("discord.com/api/webhooks")) {
        return new Response(null, { status: 204 });
      }
      // Default
      return new Response("Not Found", { status: 404 });
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("calls Discord webhook after trade when DISCORD_WEBHOOK_URL is set", async () => {
    const WEBHOOK_URL = "https://discord.com/api/webhooks/test/token";
    const bot = makeMockBot({
      botType: "copy-trader",
      platform: "polymarket",
      traderIds: ["0xtrader1"],
      maxPositionSize: 100,
      sizeFraction: 0.5,
      maxSlippage: 0.03,
      minEdge: 0.01,
      copySells: true,
    });
    // Provide env with DISCORD_WEBHOOK_URL
    const env = { ...makeTestEnv(testDb), DISCORD_WEBHOOK_URL: WEBHOOK_URL };

    await copyTraderTick(bot as any, env as any);

    const discordCalls = fetchCalls.filter((c) =>
      c.url.includes("discord.com/api/webhooks")
    );
    expect(discordCalls.length).toBeGreaterThan(0);
    expect(discordCalls[0].url).toBe(WEBHOOK_URL);
  });

  test("does not call Discord webhook when DISCORD_WEBHOOK_URL is absent", async () => {
    const bot = makeMockBot({
      botType: "copy-trader",
      platform: "polymarket",
      traderIds: ["0xtrader1"],
      maxPositionSize: 100,
      sizeFraction: 0.5,
      maxSlippage: 0.03,
      minEdge: 0.01,
      copySells: true,
    });
    // No DISCORD_WEBHOOK_URL in env
    const env = makeTestEnv(testDb);

    await copyTraderTick(bot as any, env as any);

    const discordCalls = fetchCalls.filter((c) =>
      c.url.includes("discord.com")
    );
    expect(discordCalls.length).toBe(0);
  });
});

describe("copyTraderTick — leaderboard mode", () => {
  beforeEach(() => {
    testDb = createTestDb();
    mockClient.placedOrders = [];
    mockClient.markets = [];
    mockClient.priceMap = {};
    mockClient.balance = 1000;

    fetchCalls = [];
    globalThis.fetch = async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      fetchCalls.push({ url, init });

      // Mock leaderboard API
      if (url.includes("data-api.polymarket.com/v1/leaderboard")) {
        return new Response(
          JSON.stringify([
            {
              rank: "1",
              proxyWallet: "0xABC123def456",
              userName: "TopTrader",
              pnl: 50000,
              vol: 0,
            },
          ])
        );
      }
      // Mock trader positions — empty so no trades fire
      if (url.includes("data-api.polymarket.com/positions")) {
        return new Response(JSON.stringify([]));
      }
      return new Response("Not Found", { status: 404 });
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("refreshes leaderboard and populates tracked_traders on first tick", async () => {
    const bot = makeMockBot({
      botType: "copy-trader",
      platform: "polymarket",
      leaderboardMode: true,
      traderIds: [],
      maxPositionSize: 100,
      sizeFraction: 0.5,
      maxSlippage: 0.03,
      minEdge: 0.01,
      copySells: true,
    });
    const env = makeTestEnv(testDb);

    await copyTraderTick(bot as any, env as any);

    const leaderboardCalls = fetchCalls.filter((c) =>
      c.url.includes("data-api.polymarket.com/v1/leaderboard")
    );
    expect(leaderboardCalls.length).toBeGreaterThan(0);

    // Check DB row inserted
    const rows = await testDb.select().from(trackedTraders);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].traderId).toBe("0xabc123def456"); // lowercase
  });

  test("skips leaderboard refresh when interval has not elapsed", async () => {
    const bot = makeMockBot({
      botType: "copy-trader",
      platform: "polymarket",
      leaderboardMode: true,
      // Provide recent refresh timestamp and a long refresh interval
      _lastLeaderboardRefresh: new Date().toISOString(),
      leaderboardRefreshMs: 3_600_000,
      traderIds: ["0xexisting"],
      maxPositionSize: 100,
      sizeFraction: 0.5,
      maxSlippage: 0.03,
      minEdge: 0.01,
      copySells: true,
    });
    const env = makeTestEnv(testDb);

    await copyTraderTick(bot as any, env as any);

    const leaderboardCalls = fetchCalls.filter((c) =>
      c.url.includes("data-api.polymarket.com/v1/leaderboard")
    );
    expect(leaderboardCalls.length).toBe(0);
  });

  test("stores leaderboard-sourced traders with lowercase address", async () => {
    const bot = makeMockBot({
      botType: "copy-trader",
      platform: "polymarket",
      leaderboardMode: true,
      traderIds: [],
      maxPositionSize: 100,
      sizeFraction: 0.5,
      maxSlippage: 0.03,
      minEdge: 0.01,
      copySells: true,
    });
    const env = makeTestEnv(testDb);

    await copyTraderTick(bot as any, env as any);

    const rows = await testDb.select().from(trackedTraders);
    // The mock returns proxyWallet "0xABC123def456" — should be stored as lowercase
    const inserted = rows.find((r) => r.traderId.startsWith("0x"));
    expect(inserted).toBeDefined();
    expect(inserted!.traderId).toBe(inserted!.traderId.toLowerCase());
  });

  test("updates existing tracked_trader row on subsequent leaderboard refresh", async () => {
    // Pre-insert a row with stale pnl
    await testDb.insert(trackedTraders).values({
      platform: "polymarket",
      traderId: "0xabc123def456",
      alias: "OldName",
      totalPnl: 0,
      winRate: null,
      isActive: true,
      createdAt: new Date().toISOString(),
    });

    const bot = makeMockBot({
      botType: "copy-trader",
      platform: "polymarket",
      leaderboardMode: true,
      traderIds: [],
      maxPositionSize: 100,
      sizeFraction: 0.5,
      maxSlippage: 0.03,
      minEdge: 0.01,
      copySells: true,
    });
    const env = makeTestEnv(testDb);

    await copyTraderTick(bot as any, env as any);

    const rows = await testDb.select().from(trackedTraders);
    // Should still have only one row (updated, not duplicated)
    const matching = rows.filter((r) => r.traderId === "0xabc123def456");
    expect(matching.length).toBe(1);
    expect(matching[0].alias).toBe("TopTrader");
    expect(matching[0].totalPnl).toBe(50000);
  });
});
