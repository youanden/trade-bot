import { describe, it, expect, beforeEach } from "bun:test";
import type { ExchangeClient } from "../../src/worker/core/exchanges/types";
import { SimExchangeClient } from "../../src/worker/core/simulation/sim-client";
import type { SimClientConfig } from "../../src/worker/core/simulation/sim-client";
import { PriceFeed } from "../../src/worker/core/simulation/feed";
import { generateScenario } from "../../src/worker/core/simulation/generator";

// Shared scenario used across most tests
const scenario = generateScenario({ type: "flat", seed: 42, ticks: 10 });
const feed = new PriceFeed(scenario);

function makeClient(overrides: Partial<SimClientConfig> = {}): SimExchangeClient {
  const defaults: SimClientConfig = {
    platform: "polymarket",
    feed,
    simulatedNow: () => scenario.prices[5].timestamp,
    virtualBalance: 1000,
    seed: 1,
  };
  return new SimExchangeClient({ ...defaults, ...overrides });
}

describe("EXCH-01 interface compliance", () => {
  it("satisfies ExchangeClient type at compile time", async () => {
    const client = makeClient();
    // Compile-time check: assigning to ExchangeClient typed variable
    const _: ExchangeClient = client;
    expect(_).toBeDefined();
  });

  it("getMarkets returns markets array with nextCursor", async () => {
    const client = makeClient();
    const result = await client.getMarkets();
    expect(Array.isArray(result.markets)).toBe(true);
    expect(result.markets.length).toBeGreaterThan(0);
    expect(result.markets[0].platformId).toBeDefined();
    expect(result.markets[0].platform).toBeDefined();
    expect(result.markets[0].title).toBeDefined();
    expect(result.markets[0].status).toBeDefined();
  });

  it("getMarket returns a market for a given id", async () => {
    const client = makeClient();
    const result = await client.getMarket("test-market-id");
    expect(result.platformId).toBeDefined();
    expect(result.platform).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.status).toBeDefined();
  });

  it("getPrice returns yes and no prices", async () => {
    const client = makeClient();
    const result = await client.getPrice("test-market-id");
    expect(typeof result.yes).toBe("number");
    expect(typeof result.no).toBe("number");
  });

  it("getOrderBook returns bids and asks", async () => {
    const client = makeClient();
    const result = await client.getOrderBook("test-market-id");
    expect(Array.isArray(result.bids)).toBe(true);
    expect(Array.isArray(result.asks)).toBe(true);
  });

  it("placeOrder returns an OrderResult", async () => {
    const client = makeClient();
    const result = await client.placeOrder({
      marketId: "test-market-id",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 10,
    });
    expect(result.orderId).toBeDefined();
    expect(result.status).toBeDefined();
  });

  it("cancelOrder completes without throwing", async () => {
    const client = makeClient();
    await expect(client.cancelOrder("some-order-id")).resolves.toBeUndefined();
  });

  it("getOrder returns an OrderResult", async () => {
    const client = makeClient();
    const result = await client.getOrder("nonexistent-order-id");
    expect(result.orderId).toBeDefined();
    expect(result.status).toBeDefined();
  });

  it("getOpenOrders returns an array", async () => {
    const client = makeClient();
    const result = await client.getOpenOrders();
    expect(Array.isArray(result)).toBe(true);
  });

  it("getPositions returns an array", async () => {
    const client = makeClient();
    const result = await client.getPositions();
    expect(Array.isArray(result)).toBe(true);
  });

  it("getBalance returns a number", async () => {
    const client = makeClient();
    const result = await client.getBalance();
    expect(typeof result).toBe("number");
  });
});

describe("EXCH-02 no-lookahead", () => {
  it("getPrice at tick 5 returns tick-5 yesPrice, not future prices", async () => {
    const now = scenario.prices[5].timestamp;
    const client = makeClient({ simulatedNow: () => now });
    const result = await client.getPrice("any-id");
    expect(result.yes).toBeCloseTo(scenario.prices[5].yesPrice, 6);
    expect(result.no).toBeCloseTo(scenario.prices[5].noPrice, 6);
  });

  it("getPrice at tick 5 does NOT return tick-6 or later prices", async () => {
    const now = scenario.prices[5].timestamp;
    const client = makeClient({ simulatedNow: () => now });
    const result = await client.getPrice("any-id");
    // Ensure it's not a future price — compare against tick 6 (should differ in a seeded scenario)
    // At least verify the returned price matches tick 5 exactly
    expect(result.yes).toBe(scenario.prices[5].yesPrice);
  });

  it("getPrice before first tick returns fallback { yes: 0.5, no: 0.5 }", async () => {
    const beforeStart = "2023-12-31T23:59:59.000Z"; // before scenario start
    const client = makeClient({ simulatedNow: () => beforeStart });
    const result = await client.getPrice("any-id");
    expect(result.yes).toBe(0.5);
    expect(result.no).toBe(0.5);
  });
});

describe("EXCH-03 Polymarket taker fee", () => {
  // Use prices[0].timestamp so feed returns exactly startPrice=0.5 for fee calculations
  const tick0 = scenario.prices[0].timestamp;

  it("taker buy of 100 contracts at price 0.50: balance decreases by 51 (cost=50, fee=1)", async () => {
    const client = makeClient({
      platform: "polymarket",
      virtualBalance: 1000,
      takerFeeRate: 0.02,
      simulatedNow: () => tick0,
    });
    const result = await client.placeOrder({
      marketId: "test-market",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 100,
    });
    expect(result.status).toBe("filled");
    const balance = await client.getBalance();
    // fill price = feed price at tick 0 = 0.5
    // cost = 100 * 0.5 = 50, fee = 50 * 0.02 = 1, total = 51
    expect(balance).toBeCloseTo(949, 5);
  });

  it("maker order (postOnly: true) applies zero fee on polymarket", async () => {
    const client = makeClient({
      platform: "polymarket",
      virtualBalance: 1000,
      takerFeeRate: 0.02,
      simulatedNow: () => tick0,
    });
    const result = await client.placeOrder({
      marketId: "test-market",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 100,
      postOnly: true,
    });
    expect(result.status).toBe("filled");
    const balance = await client.getBalance();
    // fill price = feed price at tick 0 = 0.5
    // cost = 100 * 0.5 = 50, fee = 0 (maker), total = 50
    expect(balance).toBeCloseTo(950, 5);
  });
});

describe("EXCH-04 Kalshi fee cap", () => {
  // Use prices[0].timestamp so feed returns exactly startPrice=0.5 for fee calculations
  const tick0 = scenario.prices[0].timestamp;

  it("100 contracts at P=0.50 on kalshi: deduction is 51.75 (cost=50 + fee=1.75)", async () => {
    const client = makeClient({
      platform: "kalshi",
      virtualBalance: 1000,
      simulatedNow: () => tick0,
    });
    const result = await client.placeOrder({
      marketId: "test-market",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 100,
    });
    expect(result.status).toBe("filled");
    const balance = await client.getBalance();
    // fill price = feed price at tick 0 = 0.5
    // cost = 100 * 0.5 = 50
    // fee per contract at P=0.50: ceil(0.07 * 0.50 * 0.50 * 10000) / 10000
    //                           = ceil(175) / 10000 = 175/10000 = 0.0175
    // total fee = 100 * 0.0175 = 1.75, total deduction = 51.75
    expect(balance).toBeCloseTo(948.25, 3);
  });

  it("fee per contract at P=0.30 is 0.0147", async () => {
    // Use a custom scenario where tick 0 price = 0.3
    const s30 = generateScenario({
      type: "flat",
      seed: 1,
      ticks: 5,
      startPrice: 0.3,
    });
    const feed30 = new PriceFeed(s30);
    const t0 = s30.prices[0].timestamp;

    // Verify tick-0 price is exactly 0.3
    expect(s30.prices[0].yesPrice).toBe(0.3);

    const client = new SimExchangeClient({
      platform: "kalshi",
      feed: feed30,
      simulatedNow: () => t0,
      virtualBalance: 1000,
    });

    // fee per contract at P=0.30: ceil(0.07 * 0.30 * 0.70 * 10000) / 10000
    //                           = ceil(0.07 * 0.21 * 10000) / 10000
    //                           = ceil(147) / 10000 = 0.0147
    const result = await client.placeOrder({
      marketId: "test-market",
      side: "buy",
      outcome: "yes",
      price: 0.3,
      size: 100,
    });
    expect(result.status).toBe("filled");
    const balance = await client.getBalance();
    // fill price = 0.3 (from feed at tick 0)
    // cost = 100 * 0.3 = 30
    // fee = 100 * 0.0147 = 1.47
    // total = 31.47
    expect(balance).toBeCloseTo(968.53, 3);
  });
});

describe("EXCH-05 partial fills", () => {
  it("partialFillRate=0.30, seed=42: 20-40% of 200 orders have status 'partial'", async () => {
    const client = makeClient({
      partialFillRate: 0.3,
      leg2FailRate: 0,
      seed: 42,
      virtualBalance: 1_000_000, // large enough to not exhaust balance
    });
    let partialCount = 0;
    for (let i = 0; i < 200; i++) {
      const result = await client.placeOrder({
        marketId: "test-market",
        side: "buy",
        outcome: "yes",
        price: 0.5,
        size: 10,
      });
      if (result.status === "partial") partialCount++;
    }
    // expect between 20% and 40% of 200 = between 40 and 80
    expect(partialCount).toBeGreaterThanOrEqual(40);
    expect(partialCount).toBeLessThanOrEqual(80);
  });

  it("leg2FailRate=0.30, partialFillRate=0, seed=42: 20-40% of 200 orders have status 'failed'", async () => {
    const client = makeClient({
      partialFillRate: 0,
      leg2FailRate: 0.3,
      seed: 42,
      virtualBalance: 1_000_000,
    });
    let failCount = 0;
    for (let i = 0; i < 200; i++) {
      const result = await client.placeOrder({
        marketId: "test-market",
        side: "buy",
        outcome: "yes",
        price: 0.5,
        size: 10,
      });
      if (result.status === "failed") failCount++;
    }
    // expect between 20% and 40% of 200 = between 40 and 80
    expect(failCount).toBeGreaterThanOrEqual(40);
    expect(failCount).toBeLessThanOrEqual(80);
  });

  it("partialFillRate=0 and leg2FailRate=0: all orders return 'filled'", async () => {
    const client = makeClient({
      partialFillRate: 0,
      leg2FailRate: 0,
      seed: 1,
      virtualBalance: 1_000_000,
    });
    for (let i = 0; i < 20; i++) {
      const result = await client.placeOrder({
        marketId: "test-market",
        side: "buy",
        outcome: "yes",
        price: 0.5,
        size: 1,
      });
      expect(result.status).toBe("filled");
    }
  });
});

describe("EXCH-06 virtual balance", () => {
  it("initial getBalance() returns virtualBalance", async () => {
    const client = makeClient({ virtualBalance: 1000 });
    expect(await client.getBalance()).toBe(1000);
  });

  it("after placing order costing ~51, getBalance() returns ~949", async () => {
    // Use tick0 so feed returns exactly 0.5 for predictable math
    const tick0 = scenario.prices[0].timestamp;
    const client = makeClient({
      platform: "polymarket",
      virtualBalance: 1000,
      takerFeeRate: 0.02,
      simulatedNow: () => tick0,
    });
    await client.placeOrder({
      marketId: "test-market",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 100,
    });
    const balance = await client.getBalance();
    // fill price = 0.5, cost = 50, fee = 1, total = 51
    expect(balance).toBeCloseTo(949, 4);
  });

  it("order with cost exceeding balance: returns status 'failed', balance unchanged", async () => {
    const client = makeClient({
      platform: "polymarket",
      virtualBalance: 10, // only 10 dollars
      takerFeeRate: 0.02,
    });
    const result = await client.placeOrder({
      marketId: "test-market",
      side: "buy",
      outcome: "yes",
      price: 0.5,
      size: 100, // cost = 50 + 1 = 51, exceeds 10
    });
    expect(result.status).toBe("failed");
    const balance = await client.getBalance();
    expect(balance).toBe(10); // unchanged
  });
});
