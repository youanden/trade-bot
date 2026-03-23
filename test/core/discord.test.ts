import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { TradeNotification } from "../../src/worker/core/notifications/discord";
import { notifyDiscord } from "../../src/worker/core/notifications/discord";

// Capture fetch calls via globalThis override
type FetchArgs = { url: string; init?: RequestInit };
let fetchCalls: FetchArgs[] = [];
let mockFetchResponse: Response = new Response(null, { status: 204 });
const origFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  mockFetchResponse = new Response(null, { status: 204 });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return mockFetchResponse;
  };
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

// Reusable fixture
const portfolioSummary = {
  cash: 800.0,
  equity: 72.0,
  realizedPnl: 5.5,
  totalFees: 1.2,
  netPnl: 4.3,
  openPositions: 2,
  totalTrades: 10,
};

const baseNotification: TradeNotification = {
  tradeType: "COPY_BUY",
  marketName: "Will BTC exceed $100k by Dec 2025?",
  outcome: "yes",
  price: 0.72,
  shares: 50,
  cost: 36.0,
  fee: 0.64,
  timestamp: "2026-03-22T18:00:00.000Z",
  portfolioSummary,
};

describe("notifyDiscord", () => {
  test("Test 1: sends POST to webhook URL with Content-Type application/json", async () => {
    const webhookUrl = "https://discord.com/api/webhooks/123/abc";
    await notifyDiscord(webhookUrl, baseNotification);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(webhookUrl);
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect((fetchCalls[0].init?.headers as Record<string, string>)?.["Content-Type"]).toBe(
      "application/json"
    );
  });

  test("Test 2: embed title contains trade type emoji and label", async () => {
    await notifyDiscord("https://discord.com/api/webhooks/123/abc", {
      ...baseNotification,
      tradeType: "COPY_BUY",
    });

    const body = JSON.parse(fetchCalls[0].init?.body as string);
    const title: string = body.embeds[0].title;
    expect(title).toContain("📈");
    expect(title).toContain("COPY");
    expect(title).toContain("BUY");
  });

  test("Test 3: embed fields include Market, Outcome, Price, Shares, Cost, Fee", async () => {
    await notifyDiscord("https://discord.com/api/webhooks/123/abc", baseNotification);

    const body = JSON.parse(fetchCalls[0].init?.body as string);
    const fields: Array<{ name: string; value: string; inline: boolean }> =
      body.embeds[0].fields;
    const fieldNames = fields.map((f) => f.name);

    expect(fieldNames).toContain("Market");
    expect(fieldNames).toContain("Outcome");
    expect(fieldNames).toContain("Price");
    expect(fieldNames).toContain("Shares");
    expect(fieldNames).toContain("Cost");
    expect(fieldNames).toContain("Fee");

    const marketField = fields.find((f) => f.name === "Market");
    expect(marketField?.value).toBe("Will BTC exceed $100k by Dec 2025?");

    const outcomeField = fields.find((f) => f.name === "Outcome");
    expect(outcomeField?.value).toBe("YES");

    const priceField = fields.find((f) => f.name === "Price");
    expect(priceField?.value).toBe("$0.720");
  });

  test("Test 4: P&L field present when pnl provided, absent when undefined", async () => {
    // With pnl
    await notifyDiscord("https://discord.com/api/webhooks/123/abc", {
      ...baseNotification,
      pnl: 12.5,
    });
    const bodyWithPnl = JSON.parse(fetchCalls[0].init?.body as string);
    const fieldsWithPnl: Array<{ name: string }> = bodyWithPnl.embeds[0].fields;
    expect(fieldsWithPnl.some((f) => f.name === "P&L")).toBe(true);

    fetchCalls = [];

    // Without pnl (undefined)
    await notifyDiscord("https://discord.com/api/webhooks/123/abc", {
      ...baseNotification,
      pnl: undefined,
    });
    const bodyNoPnl = JSON.parse(fetchCalls[0].init?.body as string);
    const fieldsNoPnl: Array<{ name: string }> = bodyNoPnl.embeds[0].fields;
    expect(fieldsNoPnl.some((f) => f.name === "P&L")).toBe(false);
  });

  test("Test 5: Copied Trader field shows abbreviated address when traderAddress provided", async () => {
    await notifyDiscord("https://discord.com/api/webhooks/123/abc", {
      ...baseNotification,
      traderAddress: "0x1234567890abcdef1234567890abcdef12345678",
    });

    const body = JSON.parse(fetchCalls[0].init?.body as string);
    const fields: Array<{ name: string; value: string }> = body.embeds[0].fields;
    const traderField = fields.find((f) => f.name === "Copied Trader");

    expect(traderField).toBeDefined();
    expect(traderField?.value).toBe("0x1234...5678");
  });

  test("Test 6: Footer text contains portfolio summary data", async () => {
    await notifyDiscord("https://discord.com/api/webhooks/123/abc", baseNotification);

    const body = JSON.parse(fetchCalls[0].init?.body as string);
    const footer: string = body.embeds[0].footer.text;

    expect(footer).toContain("Cash: $800.00");
    expect(footer).toContain("Equity: $72.00");
    expect(footer).toContain("Realized P&L: $5.50");
    expect(footer).toContain("Fees: $1.20");
    expect(footer).toContain("Net: $4.30");
    expect(footer).toContain("Positions: 2");
    expect(footer).toContain("Trades: 10");
  });

  test("Test 7: notifyDiscord does NOT throw when fetch returns non-ok status (429)", async () => {
    mockFetchResponse = new Response(
      JSON.stringify({ message: "You are being rate limited" }),
      { status: 429 }
    );

    // Should resolve without throwing
    await expect(
      notifyDiscord("https://discord.com/api/webhooks/123/abc", baseNotification)
    ).resolves.toBeUndefined();
  });

  test("Test 8: notifyDiscord does NOT throw when fetch rejects with network error", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Network error");
    };

    // Should resolve without throwing
    await expect(
      notifyDiscord("https://discord.com/api/webhooks/123/abc", baseNotification)
    ).resolves.toBeUndefined();
  });

  test("Test 9: Category field included when category is provided", async () => {
    await notifyDiscord("https://discord.com/api/webhooks/123/abc", {
      ...baseNotification,
      category: "CRYPTO",
    });

    const body = JSON.parse(fetchCalls[0].init?.body as string);
    const fields: Array<{ name: string; value: string }> = body.embeds[0].fields;
    const categoryField = fields.find((f) => f.name === "Category");

    expect(categoryField).toBeDefined();
    expect(categoryField?.value).toBe("[CRYPTO]");
  });
});
