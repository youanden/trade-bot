import { describe, test, expect } from "bun:test";
import {
  calculateSharpe,
  calculateMaxDrawdown,
  calculateProfitFactor,
} from "../../src/worker/core/risk/analytics";

describe("calculateSharpe", () => {
  test("returns 0 for empty array", () => {
    expect(calculateSharpe([])).toBe(0);
  });

  test("returns 0 for single value", () => {
    expect(calculateSharpe([10])).toBe(0);
  });

  test("returns positive for consistently positive PnL", () => {
    const pnls = [10, 12, 8, 15, 11, 9, 13];
    expect(calculateSharpe(pnls)).toBeGreaterThan(0);
  });

  test("returns 0 when all values are the same", () => {
    expect(calculateSharpe([5, 5, 5, 5])).toBe(0);
  });
});

describe("calculateMaxDrawdown", () => {
  test("returns 0 for empty array", () => {
    expect(calculateMaxDrawdown([])).toBe(0);
  });

  test("returns 0 when all positive", () => {
    expect(calculateMaxDrawdown([10, 10, 10])).toBe(0);
  });

  test("calculates drawdown correctly", () => {
    // Cumulative: 10, 20, 15, 25
    // Peak: 10, 20, 20, 25
    // DD: 0, 0, 5, 0
    // MaxDD = 5, Peak at time of DD = 25, so 5/25 = 0.20
    const dd = calculateMaxDrawdown([10, 10, -5, 10]);
    expect(dd).toBeCloseTo(0.2, 2);
  });
});

describe("calculateProfitFactor", () => {
  test("returns 0 for empty array", () => {
    expect(calculateProfitFactor([])).toBe(0);
  });

  test("returns Infinity when no losses", () => {
    expect(calculateProfitFactor([10, 20, 5])).toBe(Infinity);
  });

  test("calculates correctly", () => {
    // Profit: 10 + 20 = 30, Loss: 5 + 10 = 15
    const pf = calculateProfitFactor([10, -5, 20, -10]);
    expect(pf).toBeCloseTo(2.0, 1);
  });
});
