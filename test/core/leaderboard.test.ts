import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { fetchLeaderboard } from "../../src/worker/core/exchanges/polymarket/leaderboard";

// Mock leaderboard fixture — mirrors live API response shape
const MOCK_ENTRIES = [
  {
    rank: "1",
    proxyWallet: "0x02227b8f5a9636e895607edd3185ed6ee5598ff7",
    userName: "HorizonSplendidView",
    xUsername: "",
    verifiedBadge: false,
    vol: 0,
    pnl: 4598456.548919337,
    profileImage: "",
  },
  {
    rank: "2",
    proxyWallet: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    userName: "",
    xUsername: "",
    verifiedBadge: false,
    vol: 123456.78,
    pnl: 3200000.0,
    profileImage: "",
  },
  {
    rank: "3",
    proxyWallet: "0x9999999999999999999999999999999999999999",
    userName: "ThirdPlace",
    xUsername: "thirdplace_x",
    verifiedBadge: true,
    vol: null as unknown as number,
    pnl: null as unknown as number,
    profileImage: "",
  },
];

const origFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(MOCK_ENTRIES), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("fetchLeaderboard", () => {
  it("returns LeaderboardEntry[] with rank, proxyWallet, userName, pnl, vol parsed from API response", async () => {
    const entries = await fetchLeaderboard();
    expect(entries).toHaveLength(3);
    expect(entries[0].rank).toBe(1);
    expect(entries[0].proxyWallet).toBeTruthy();
    expect(entries[0].userName).toBe("HorizonSplendidView");
    expect(entries[0].pnl).toBeCloseTo(4598456.548919337);
    expect(entries[0].vol).toBe(0);
  });

  it("passes timePeriod, orderBy, and limit query params to the URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify([]), { status: 200 });
    };

    await fetchLeaderboard({ timePeriod: "WEEK", orderBy: "PNL", limit: 10 });

    expect(capturedUrl).toContain("timePeriod=WEEK");
    expect(capturedUrl).toContain("orderBy=PNL");
    expect(capturedUrl).toContain("limit=10");
    expect(capturedUrl).toContain("data-api.polymarket.com/v1/leaderboard");
  });

  it("converts string rank to number", async () => {
    const entries = await fetchLeaderboard();
    expect(typeof entries[0].rank).toBe("number");
    expect(entries[0].rank).toBe(1);
    expect(entries[1].rank).toBe(2);
    expect(entries[2].rank).toBe(3);
  });

  it("defaults userName to proxyWallet when userName is empty string", async () => {
    const entries = await fetchLeaderboard();
    // entry[1] has empty userName — should default to proxyWallet (lowercased)
    expect(entries[1].userName).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("defaults vol and pnl to 0 when null/undefined", async () => {
    const entries = await fetchLeaderboard();
    // entry[2] has null vol and null pnl
    expect(entries[2].vol).toBe(0);
    expect(entries[2].pnl).toBe(0);
  });

  it("throws on non-ok response with status code in message", async () => {
    globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("Server Error", { status: 500 });
    };

    await expect(fetchLeaderboard()).rejects.toThrow("Leaderboard API 500");
  });

  it("normalizes proxyWallet to lowercase", async () => {
    const entries = await fetchLeaderboard();
    // entry[1] has a mixed-case proxyWallet in the fixture
    expect(entries[1].proxyWallet).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
    // entry[0] is already lowercase — should remain unchanged
    expect(entries[0].proxyWallet).toBe(
      "0x02227b8f5a9636e895607edd3185ed6ee5598ff7",
    );
  });
});
