import { describe, test, expect } from "bun:test";

// Test the title similarity logic directly
function tokenize(text: string): Set<string> {
  const stopWords = new Set([
    "the", "a", "an", "in", "on", "at", "to", "of", "by", "for",
    "will", "be", "is", "are", "was", "were", "has", "have", "do",
    "does", "did", "this", "that", "it", "or", "and", "if", "than",
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w))
  );
}

function titleSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

describe("titleSimilarity", () => {
  test("identical titles return 1.0", () => {
    expect(
      titleSimilarity(
        "Will Bitcoin reach $100k by end of 2025?",
        "Will Bitcoin reach $100k by end of 2025?"
      )
    ).toBe(1.0);
  });

  test("similar titles return high score", () => {
    const score = titleSimilarity(
      "Will Bitcoin reach $100k by end of 2025?",
      "Bitcoin to hit $100k before 2026?"
    );
    expect(score).toBeGreaterThan(0.2);
  });

  test("unrelated titles return low score", () => {
    const score = titleSimilarity(
      "Will Bitcoin reach $100k?",
      "Who will win the Super Bowl?"
    );
    expect(score).toBeLessThan(0.2);
  });

  test("handles stop words correctly", () => {
    const score = titleSimilarity(
      "The president will be elected in November",
      "President elected November"
    );
    expect(score).toBe(1.0);
  });
});
