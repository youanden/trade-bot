import type { KellyParams, RiskCheck } from "./types";

/**
 * Kelly criterion position sizing.
 *
 * Full Kelly: f* = (p * b - q) / b
 *   where p = win probability, q = 1-p, b = net odds (payout / stake)
 *
 * In prediction markets: buying YES at price P with true probability p:
 *   b = (1 - P) / P  (payout = $1, cost = $P, net = $(1-P))
 *   f* = (p * (1-P) - (1-p) * P) / (1-P)
 *       = (p - P) / (1 - P)
 */
export function kellyFraction(probability: number, marketPrice: number): number {
  if (probability <= 0 || probability >= 1) return 0;
  if (marketPrice <= 0 || marketPrice >= 1) return 0;

  // Edge: if our estimated prob <= market price, no bet
  if (probability <= marketPrice) return 0;

  return (probability - marketPrice) / (1 - marketPrice);
}

/**
 * Calculate recommended position size using Kelly criterion.
 *
 * @param params.probability - Our estimated probability of YES
 * @param params.odds - Market price for YES (0-1)
 * @param params.bankroll - Available capital
 * @param params.fraction - Kelly fraction (default 0.25 = quarter Kelly for safety)
 */
export function kellySize(params: KellyParams): RiskCheck {
  const { probability, odds: marketPrice, bankroll, fraction = 0.25 } = params;

  const fullKelly = kellyFraction(probability, marketPrice);

  if (fullKelly <= 0) {
    return {
      allowed: false,
      reason: `No edge: p=${probability.toFixed(3)} <= market=${marketPrice.toFixed(3)}`,
      suggestedSize: 0,
    };
  }

  const adjustedKelly = fullKelly * fraction;
  const suggestedSize = Math.floor(bankroll * adjustedKelly * 100) / 100; // Round down to cents

  if (suggestedSize < 1) {
    return {
      allowed: false,
      reason: `Position too small: $${suggestedSize.toFixed(2)}`,
      suggestedSize: 0,
    };
  }

  return {
    allowed: true,
    suggestedSize,
  };
}

/**
 * Kelly for selling (going short / buying NO).
 * When we think market overvalues YES:
 *   Buy NO at price (1 - marketPrice)
 *   True prob of NO = (1 - probability)
 */
export function kellySizeNo(params: KellyParams): RiskCheck {
  return kellySize({
    ...params,
    probability: 1 - params.probability,
    odds: 1 - params.odds,
  });
}
