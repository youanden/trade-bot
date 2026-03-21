# Testing Patterns

**Analysis Date:** 2026-03-21

## Test Framework

**Runner:**
- Bun's built-in test runner (`bun:test`)
- No separate Jest or Vitest config file — `bun test` runs directly
- Config: none detected (no `jest.config.*`, no `vitest.config.*`)

**Assertion Library:**
- Bun's built-in `expect` (Jest-compatible API)

**Run Commands:**
```bash
bun test              # Run all tests
bun test --watch      # Watch mode (bun native)
bun test --coverage   # Coverage (bun native flag)
```

## Test File Organization

**Location:**
- Separate `test/` directory at project root — NOT co-located with source
- Mirror of `src/worker/core/` structure under `test/core/`

**Naming:**
- `{moduleName}.test.ts` matching the source file name (e.g., `kelly.test.ts` tests `src/worker/core/risk/kelly.ts`)

**Current structure:**
```
test/
└── core/
    ├── kelly.test.ts       # Tests for src/worker/core/risk/kelly.ts
    ├── analytics.test.ts   # Tests for src/worker/core/risk/analytics.ts
    └── matcher.test.ts     # Tests for src/worker/core/market/matcher.ts (inline copy)
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, test, expect } from "bun:test";
import { functionUnderTest } from "../../src/worker/core/module/file";

describe("functionName", () => {
  test("returns X when Y", () => {
    const result = functionUnderTest(input);
    expect(result).toBe(expected);
  });

  test("handles edge case", () => {
    expect(functionUnderTest(edgeInput)).toBe(0);
  });
});
```

**Patterns:**
- One `describe` block per exported function
- `test()` used (not `it()`)
- Test names use plain English describing the scenario: `"returns positive fraction when we have edge"`, `"rejects when no edge"`
- Each test is self-contained — no shared setup or `beforeEach`/`afterEach` found
- Math-heavy tests use `toBeCloseTo(value, decimalPlaces)` for floating-point assertions

## Mocking

**Framework:** None detected — no mock utilities imported or used in any test files

**Current approach:** Tests are written against pure/stateless functions that take primitive inputs and return values. No database, HTTP, or Durable Object dependencies are tested.

**What to Mock (when tests are added):**
- Database (`Database` type from `src/worker/core/db/client.ts`) — use a mock or in-memory D1 instance
- `ExchangeClient` interface from `src/worker/core/exchanges/types.ts` — interface-based, easy to mock
- `Env` bindings (Cloudflare Workers) — construct minimal object with required keys

**What NOT to Mock:**
- Pure computation functions (`kellyFraction`, `calculateSharpe`, `calculateMaxDrawdown`, `calculateProfitFactor`) — test directly with real inputs

## Fixtures and Factories

**Test Data:**
- Inline literal values only — no fixture files or factory helpers exist yet
```typescript
// Example from kelly.test.ts
const result = kellySize({
  probability: 0.7,
  odds: 0.5,
  bankroll: 1000,
  fraction: 0.25,
});
```

**Location:**
- No dedicated fixtures directory exists

## Coverage

**Requirements:** None enforced — no coverage threshold configuration detected

**View Coverage:**
```bash
bun test --coverage
```

## Test Types

**Unit Tests:**
- All existing tests are pure unit tests
- Scope: individual exported functions from the `src/worker/core/risk/` and `src/worker/core/market/` modules
- No I/O, no network, no DB

**Integration Tests:**
- None exist currently

**E2E Tests:**
- Not used

## Notable Pattern: Inline Function Copy (matcher.test.ts)

`test/core/matcher.test.ts` does NOT import from `src/worker/core/market/matcher.ts`. Instead, it copies the `tokenize` and `titleSimilarity` private methods inline into the test file. This is because `MarketMatcher` exposes these as private methods.

When adding tests for `MarketMatcher`, either:
1. Extract `titleSimilarity`/`tokenize` to a separate exported utility function in `src/worker/core/market/matcher.ts`
2. Or test `MarketMatcher.findMatches()` end-to-end with a mocked `Database`

## Common Patterns

**Numeric/floating-point assertions:**
```typescript
// Use toBeCloseTo for derived calculations
expect(f).toBeCloseTo(0.4, 1);       // 1 decimal place precision
expect(dd).toBeCloseTo(0.2, 2);      // 2 decimal place precision

// Use exact matchers for integer/boundary values
expect(kellyFraction(0.5, 0.5)).toBe(0);
expect(result.allowed).toBe(true);
```

**Range assertions for derived values:**
```typescript
expect(result.suggestedSize).toBeGreaterThanOrEqual(99);
expect(result.suggestedSize).toBeLessThanOrEqual(100);
```

**Edge case coverage pattern:**
```typescript
// Always include: empty input, boundary inputs, invalid inputs
test("returns 0 for empty array", () => {
  expect(calculateSharpe([])).toBe(0);
});
test("returns 0 for single value", () => {
  expect(calculateSharpe([10])).toBe(0);
});
test("returns 0 for invalid inputs", () => {
  expect(kellyFraction(0, 0.5)).toBe(0);   // lower bound
  expect(kellyFraction(1, 0.5)).toBe(0);   // upper bound
  expect(kellyFraction(0.5, 0)).toBe(0);   // zero odds
  expect(kellyFraction(0.5, 1)).toBe(0);   // max odds
});
```

**Structural/object assertions:**
```typescript
expect(result.allowed).toBe(false);
expect(result.suggestedSize).toBe(0);
```

## Coverage Gaps

The following modules have no test coverage:

- `src/worker/core/risk/portfolio.ts` (`PortfolioRisk` class — DB-dependent)
- `src/worker/core/risk/limits.ts`
- `src/worker/core/market/resolver.ts`
- `src/worker/core/exchanges/kalshi/client.ts` (HTTP-dependent)
- `src/worker/core/exchanges/polymarket/client.ts` (HTTP-dependent)
- All bot strategies under `src/worker/bots/*/strategy.ts`
- `src/worker/bots/base.ts` (`BaseBotDO`)
- All API routes under `src/worker/api/routes/`
- All UI code under `src/ui/`

---

*Testing analysis: 2026-03-21*
