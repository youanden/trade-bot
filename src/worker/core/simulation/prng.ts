// Source: mulberry32 public domain — https://gist.github.com/tommyettinger/46a874533244883189143505d203312c

/**
 * Creates a seeded PRNG using the mulberry32 algorithm.
 * Returns a function that yields uniform floats in [0, 1) per call.
 * Pure TypeScript — no Node.js or crypto APIs required.
 *
 * @param seed - Integer seed (use non-zero; 0 is treated as 1)
 */
export function createPrng(seed: number): () => number {
  let s = (seed || 1) >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
