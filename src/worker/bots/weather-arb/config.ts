import type { BotConfig } from "../base";

export interface WeatherArbConfig extends BotConfig {
  botType: "weather-arb";
  /** Platform to trade on */
  platform: "polymarket" | "kalshi";
  /** Weather API key */
  weatherApiKey?: string;
  /** Cities / regions to monitor */
  locations: string[];
  /** Min edge to trade */
  minEdge: number;
  maxPositionSize: number;
}

export const DEFAULT_WEATHER_ARB_CONFIG: Partial<WeatherArbConfig> = {
  botType: "weather-arb",
  tickIntervalMs: 600_000, // 10 min
  platform: "kalshi",
  locations: ["Chicago", "New York", "Los Angeles"],
  minEdge: 0.08,
  maxPositionSize: 150,
};
