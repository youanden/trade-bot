import { createDb } from "../../core/db/client";
import { PortfolioRisk } from "../../core/risk/portfolio";
import { getLimitsForBot } from "../../core/risk/limits";
import { createExchangeClient } from "../../core/exchanges/factory";
import { ensureMarket } from "../../core/exchanges/helpers";
import { kellySize, kellySizeNo } from "../../core/risk/kelly";
import type { ExchangeClient } from "../../core/exchanges/types";
import type { BaseBotDO } from "../base";
import type { WeatherArbConfig } from "./config";
import { Logger } from "../../core/utils/logger";

const log = new Logger({ strategy: "weather-arb" });

// City → lat/lon lookup for NWS API
const CITY_COORDINATES: Record<string, { lat: number; lon: number }> = {
  "New York": { lat: 40.7128, lon: -74.006 },
  "Chicago": { lat: 41.8781, lon: -87.6298 },
  "Los Angeles": { lat: 34.0522, lon: -118.2437 },
  "Miami": { lat: 25.7617, lon: -80.1918 },
  "Dallas": { lat: 32.7767, lon: -96.797 },
  "Denver": { lat: 39.7392, lon: -104.9903 },
  "Seattle": { lat: 47.6062, lon: -122.3321 },
  "Boston": { lat: 42.3601, lon: -71.0589 },
  "Atlanta": { lat: 33.749, lon: -84.388 },
  "Phoenix": { lat: 33.4484, lon: -112.074 },
  "Houston": { lat: 29.7604, lon: -95.3698 },
  "Philadelphia": { lat: 39.9526, lon: -75.1652 },
  "San Francisco": { lat: 37.7749, lon: -122.4194 },
  "Washington": { lat: 38.9072, lon: -77.0369 },
  "Minneapolis": { lat: 44.9778, lon: -93.265 },
};

// Kalshi city ticker abbreviations
const CITY_TICKER_MAP: Record<string, string> = {
  "New York": "NY",
  "Chicago": "CHI",
  "Los Angeles": "LA",
  "Miami": "MIA",
  "Dallas": "DAL",
  "Denver": "DEN",
  "Seattle": "SEA",
  "Boston": "BOS",
  "Atlanta": "ATL",
  "Phoenix": "PHX",
  "Houston": "HOU",
  "Philadelphia": "PHI",
  "San Francisco": "SF",
  "Washington": "DC",
  "Minneapolis": "MIN",
};

/**
 * Weather arbitrage strategy.
 *
 * Compares NWS forecast probabilities against Kalshi weather market prices.
 * Trades when forecast strongly disagrees with market pricing.
 */
export async function weatherArbTick(
  bot: BaseBotDO,
  env: Env
): Promise<void> {
  const config = (bot as any).config as WeatherArbConfig;
  const db = createDb(env.DB);
  const risk = new PortfolioRisk(db, getLimitsForBot("weather-arb"));

  if (await risk.isDailyLossBreached()) {
    log.warn("tick:daily-loss-breached");
    return;
  }

  let client: ExchangeClient;
  try {
    client = createExchangeClient(env, config.platform);
  } catch (err) {
    log.error("tick:client-init-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const location of config.locations) {
    try {
      await processLocation(bot, client, db, config, risk, location);
    } catch (err) {
      log.error("tick:location-error", {
        location,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function processLocation(
  bot: BaseBotDO,
  client: ExchangeClient,
  db: ReturnType<typeof createDb>,
  config: WeatherArbConfig,
  risk: PortfolioRisk,
  location: string
): Promise<void> {
  const coords = CITY_COORDINATES[location];
  if (!coords) {
    log.warn("tick:unknown-location", { location });
    return;
  }

  // 1. Fetch NWS forecast
  const forecast = await fetchNWSForecast(coords.lat, coords.lon);
  if (!forecast) {
    log.warn("tick:forecast-failed", { location });
    return;
  }

  log.debug("tick:forecast-fetched", {
    location,
    tempHigh: forecast.tempHigh,
    tempLow: forecast.tempLow,
    precipProb: forecast.precipProbability,
  });

  // 2. Fetch weather markets from exchange
  const { markets: allMarkets } = await client.getMarkets({
    limit: 100,
    status: "active",
  });

  // Filter for weather-related markets for this location
  const cityAbbr = CITY_TICKER_MAP[location] ?? "";
  const weatherMarkets = allMarkets.filter((m) => {
    const id = m.platformId.toUpperCase();
    return (
      (id.includes("KXHIGH") ||
        id.includes("KXLOW") ||
        id.includes("KXTEMP") ||
        id.includes("KXRAIN") ||
        id.includes("KXPRECIP")) &&
      id.includes(cityAbbr)
    );
  });

  if (weatherMarkets.length === 0) {
    log.debug("tick:no-weather-markets", { location, cityAbbr });
    return;
  }

  // 3. Evaluate each weather market
  for (const market of weatherMarkets) {
    const price = await client.getPrice(market.platformId).catch(() => null);
    if (!price) continue;

    // Parse threshold from ticker (e.g., KXHIGHNY-25MAR21-T52 → temp above 52°F)
    const parsed = parseWeatherTicker(market.platformId);
    if (!parsed) continue;

    // Calculate forecast probability for this threshold
    const forecastProb = calculateForecastProbability(
      parsed.type,
      parsed.threshold,
      forecast
    );

    if (forecastProb === null) continue;

    const edge = Math.abs(forecastProb - price.yes);

    log.debug("tick:evaluating-market", {
      market: market.title,
      ticker: market.platformId,
      marketPrice: price.yes,
      forecastProb,
      edge,
    });

    if (edge < config.minEdge) continue;

    // Size with Kelly
    const balance = await client.getBalance();
    const shouldBuyYes = forecastProb > price.yes;

    const sizing = shouldBuyYes
      ? kellySize({
          probability: forecastProb,
          odds: price.yes,
          bankroll: balance,
          fraction: 0.15,
        })
      : kellySizeNo({
          probability: forecastProb,
          odds: price.yes,
          bankroll: balance,
          fraction: 0.15,
        });

    if (!sizing.allowed) continue;

    const tradeSize = Math.min(
      sizing.suggestedSize ?? 0,
      config.maxPositionSize
    );
    if (tradeSize < 1) continue;

    const riskCheck = await risk.checkTrade({
      botInstanceId: config.dbBotId,
      size: tradeSize,
      price: shouldBuyYes ? price.yes : price.no,
    });

    if (!riskCheck.allowed) {
      log.info("tick:risk-blocked", { reason: riskCheck.reason });
      continue;
    }

    const finalSize = riskCheck.suggestedSize ?? tradeSize;

    log.info("tick:trading-weather", {
      market: market.title,
      side: shouldBuyYes ? "buy-yes" : "buy-no",
      forecastProb,
      marketPrice: price.yes,
      edge,
      size: finalSize,
    });

    const orderResult = await client.placeOrder({
      marketId: market.platformId,
      side: "buy",
      outcome: shouldBuyYes ? "yes" : "no",
      price: shouldBuyYes ? price.yes : price.no,
      size: finalSize,
    });

    if (orderResult.status === "failed") {
      log.error("tick:order-failed", { orderId: orderResult.orderId });
      continue;
    }

    const dbMarketId = await ensureMarket(db, market);

    await (bot as any).recordTrade({
      marketId: dbMarketId,
      platform: config.platform,
      side: "buy",
      outcome: shouldBuyYes ? "yes" : "no",
      price: orderResult.filledPrice ?? (shouldBuyYes ? price.yes : price.no),
      size: orderResult.filledSize ?? finalSize,
      reason: `weather-arb:${location}:edge=${edge.toFixed(3)}:forecast=${forecastProb.toFixed(3)}`,
    });
  }
}

// ── NWS Forecast Fetching ──

interface WeatherForecast {
  tempHigh: number; // °F
  tempLow: number; // °F
  tempMean: number;
  tempStdDev: number; // estimated uncertainty
  precipProbability: number; // 0-1
}

async function fetchNWSForecast(
  lat: number,
  lon: number
): Promise<WeatherForecast | null> {
  try {
    // Step 1: Get grid point from coordinates
    const pointRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: { "User-Agent": "trade-bot/1.0" } }
    );
    if (!pointRes.ok) return null;
    const pointData: any = await pointRes.json();

    const forecastUrl = pointData.properties?.forecastHourly;
    if (!forecastUrl) return null;

    // Step 2: Get hourly forecast
    const forecastRes = await fetch(forecastUrl, {
      headers: { "User-Agent": "trade-bot/1.0" },
    });
    if (!forecastRes.ok) return null;
    const forecastData: any = await forecastRes.json();

    const periods = forecastData.properties?.periods ?? [];
    if (periods.length === 0) return null;

    // Get next 24 hours of data
    const next24h = periods.slice(0, 24);
    const temps = next24h.map((p: any) => p.temperature as number);
    const precipProbs = next24h.map(
      (p: any) => (p.probabilityOfPrecipitation?.value ?? 0) / 100
    );

    const tempHigh = Math.max(...temps);
    const tempLow = Math.min(...temps);
    const tempMean = temps.reduce((a: number, b: number) => a + b, 0) / temps.length;
    const tempVariance =
      temps.reduce((sum: number, t: number) => sum + (t - tempMean) ** 2, 0) /
      temps.length;
    const tempStdDev = Math.sqrt(tempVariance);
    const precipProbability = Math.max(...precipProbs);

    return { tempHigh, tempLow, tempMean, tempStdDev, precipProbability };
  } catch {
    return null;
  }
}

// ── Ticker Parsing ──

interface ParsedWeatherTicker {
  type: "high" | "low" | "precip";
  threshold: number;
  city: string;
}

function parseWeatherTicker(ticker: string): ParsedWeatherTicker | null {
  // Format: KXHIGHNY-25MAR21-T52 or KXRAINCHI-25MAR21
  const upper = ticker.toUpperCase();

  let type: "high" | "low" | "precip";
  if (upper.includes("KXHIGH")) type = "high";
  else if (upper.includes("KXLOW")) type = "low";
  else if (upper.includes("KXRAIN") || upper.includes("KXPRECIP"))
    type = "precip";
  else return null;

  // Extract threshold from -T{number} suffix
  const thresholdMatch = upper.match(/-T(\d+)/);
  const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 0;

  // Extract city code
  const cityMatch = upper.match(/KX(?:HIGH|LOW|RAIN|PRECIP|TEMP)(\w+)-/);
  const city = cityMatch ? cityMatch[1] : "";

  return { type, threshold, city };
}

// ── Probability Calculation ──

/**
 * Approximate normal CDF using Abramowitz-Stegun method.
 */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

function calculateForecastProbability(
  type: "high" | "low" | "precip",
  threshold: number,
  forecast: WeatherForecast
): number | null {
  if (type === "precip") {
    return forecast.precipProbability;
  }

  // For temperature markets, use normal distribution approximation
  const stdDev = Math.max(forecast.tempStdDev, 2); // minimum 2°F uncertainty

  if (type === "high") {
    // P(high temp >= threshold)
    const z = (threshold - forecast.tempHigh) / stdDev;
    return 1 - normalCDF(z);
  }

  if (type === "low") {
    // P(low temp <= threshold)
    const z = (threshold - forecast.tempLow) / stdDev;
    return normalCDF(z);
  }

  return null;
}
