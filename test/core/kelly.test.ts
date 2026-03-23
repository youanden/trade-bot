import { describe, test, expect } from "bun:test";
import { kellyFraction, kellySize, kellySizeNo } from "../../src/worker/core/risk/kelly";

describe("kellyFraction", () => {
  test("returns positive fraction when we have edge", () => {
    // We think 70% likely, market at 50%
    const f = kellyFraction(0.7, 0.5);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeCloseTo(0.4, 1); // (0.7 - 0.5) / (1 - 0.5) = 0.4
  });

  test("returns 0 when no edge", () => {
    expect(kellyFraction(0.5, 0.5)).toBe(0);
    expect(kellyFraction(0.4, 0.5)).toBe(0);
  });

  test("returns 0 for invalid inputs", () => {
    expect(kellyFraction(0, 0.5)).toBe(0);
    expect(kellyFraction(1, 0.5)).toBe(0);
    expect(kellyFraction(0.5, 0)).toBe(0);
    expect(kellyFraction(0.5, 1)).toBe(0);
  });

  test("higher edge = higher fraction", () => {
    const small = kellyFraction(0.55, 0.5);
    const large = kellyFraction(0.8, 0.5);
    expect(large).toBeGreaterThan(small);
  });
});

describe("kellySize", () => {
  test("calculates position size with quarter Kelly", () => {
    const result = kellySize({
      probability: 0.7,
      odds: 0.5,
      bankroll: 1000,
      fraction: 0.25,
    });
    expect(result.allowed).toBe(true);
    expect(result.suggestedSize).toBeGreaterThan(0);
    expect(result.suggestedSize!).toBeLessThan(1000);
    // Full Kelly = 0.4, quarter = 0.1, position ≈ $100
    expect(result.suggestedSize).toBeGreaterThanOrEqual(99);
    expect(result.suggestedSize).toBeLessThanOrEqual(100);
  });

  test("rejects when no edge", () => {
    const result = kellySize({
      probability: 0.45,
      odds: 0.5,
      bankroll: 1000,
    });
    expect(result.allowed).toBe(false);
    expect(result.suggestedSize).toBe(0);
  });

  test("rejects when position too small", () => {
    const result = kellySize({
      probability: 0.51,
      odds: 0.5,
      bankroll: 10, // tiny bankroll
    });
    expect(result.allowed).toBe(false);
  });
});

describe("kellySizeNo", () => {
  test("inverts for NO side", () => {
    // Market YES at 80%, we think only 30% likely -> sell YES / buy NO
    const result = kellySizeNo({
      probability: 0.3, // our prob of YES
      odds: 0.8, // market YES price
      bankroll: 1000,
      fraction: 0.25,
    });
    expect(result.allowed).toBe(true);
    expect(result.suggestedSize).toBeGreaterThan(0);
  });
});
