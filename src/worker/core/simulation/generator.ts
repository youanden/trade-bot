import { createPrng } from "./prng";
import type { GeneratorParams, GeneratedScenario, ScenarioType } from "./types";

/** logit(p) = ln(p / (1-p)) — maps (0,1) → (-∞, +∞) */
function logit(p: number): number {
  return Math.log(p / (1 - p));
}

/** sigmoid(x) = 1 / (1 + exp(-x)) — maps (-∞, +∞) → (0,1) */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

interface ScenarioConfig {
  drift: number;
  sigma: number;
  crashTick?: number;
  crashShock?: number;
}

const SCENARIO_CONFIGS: Record<
  ScenarioType,
  (ticks: number) => ScenarioConfig
> = {
  bull: () => ({ drift: 0.05, sigma: 0.1 }),
  bear: () => ({ drift: -0.05, sigma: 0.1 }),
  flat: () => ({ drift: 0.0, sigma: 0.04 }),
  volatile: () => ({ drift: 0.0, sigma: 0.25 }),
  crash: (ticks) => ({
    drift: 0.03,
    sigma: 0.08,
    crashTick: Math.floor(ticks * 0.6),
    crashShock: -5.0,
  }),
};

/**
 * Generates a price series of length `ticks` in logit space.
 * Uses Box-Muller transform for normal samples from the seeded PRNG.
 *
 * @param params - drift, sigma, ticks, startPrice, rng, crashTick, crashShock
 */
function generatePriceSeries(params: {
  ticks: number;
  startPrice: number;
  drift: number;
  sigma: number;
  rng: () => number;
  crashTick?: number;
  crashShock?: number;
}): number[] {
  const { ticks, startPrice, drift, sigma, rng, crashTick, crashShock } =
    params;
  const result: number[] = [startPrice];
  let logitP = logit(startPrice);

  for (let i = 1; i < ticks; i++) {
    // Box-Muller normal sample from two uniform randoms
    // epsilon guard on u1 prevents Math.log(0) = -Infinity
    const u1 = rng();
    const u2 = rng();
    const z =
      Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    logitP += drift + sigma * z;

    // Apply crash shock at the tick AFTER crashTick so prices[crashTick]
    // holds the pre-crash high. The shock builds the price for tick i,
    // so applying at i === crashTick + 1 ensures prices[crashTick] is the
    // last pre-shock value.
    if (
      crashTick !== undefined &&
      crashShock !== undefined &&
      i === crashTick + 1
    ) {
      logitP += crashShock;
    }

    result.push(Math.min(0.99, Math.max(0.01, sigmoid(logitP))));
  }

  return result;
}

/**
 * Generates a complete simulation scenario with a market row and price rows
 * compatible with the Drizzle markets and prices schema.
 *
 * @param params - ScenarioType, seed, ticks, and optional overrides
 */
export function generateScenario(params: GeneratorParams): GeneratedScenario {
  const {
    type,
    seed,
    ticks,
    startPrice = 0.5,
    tickIntervalMs = 60_000,
    startTime = "2024-01-01T00:00:00.000Z",
  } = params;

  // 1. Create seeded PRNG
  const rng = createPrng(seed);

  // 2. Get scenario config
  const config = SCENARIO_CONFIGS[type](ticks);

  // 3. Generate raw price series
  const rawPrices = generatePriceSeries({
    ticks,
    startPrice,
    drift: config.drift,
    sigma: config.sigma,
    rng,
    crashTick: config.crashTick,
    crashShock: config.crashShock,
  });

  // 4. Build market row (omit id — assigned by autoincrement after insert)
  const market: GeneratedScenario["market"] = {
    platform: "polymarket",
    platformId: `sim-${type}-${seed}`,
    title: `Simulated ${type} market (seed ${seed})`,
    status: "active",
  };

  // 5. Build price rows (omit id and marketId — caller supplies marketId after insert)
  const startMs = new Date(startTime).getTime();
  const priceRows: GeneratedScenario["prices"] = rawPrices.map((price, i) => {
    const rounded = Math.round((1 - price) * 10000) / 10000;
    return {
      timestamp: new Date(startMs + i * tickIntervalMs).toISOString(),
      yesPrice: price,
      noPrice: rounded,
    };
  });

  return { market, prices: priceRows };
}
