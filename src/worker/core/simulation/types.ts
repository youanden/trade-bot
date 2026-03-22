import type { markets, prices } from "../../db/schema";

export type ScenarioType = "bull" | "bear" | "flat" | "volatile" | "crash";

export interface GeneratorParams {
  type: ScenarioType;
  seed: number;
  ticks: number;
  startPrice?: number; // default 0.5
  tickIntervalMs?: number; // default 60_000
  startTime?: string; // default '2024-01-01T00:00:00.000Z'
}

export type MarketInsert = typeof markets.$inferInsert;
export type PriceInsert = typeof prices.$inferInsert;

export interface GeneratedScenario {
  market: Omit<MarketInsert, "id">;
  prices: Array<
    Omit<PriceInsert, "id"> & {
      timestamp: string;
      yesPrice: number;
      noPrice: number;
    }
  >;
}
