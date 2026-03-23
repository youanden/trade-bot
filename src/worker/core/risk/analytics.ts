import type { Database } from "../db/client";
import { trades, botMetrics, botInstances } from "../db/schema";
import { eq, desc } from "drizzle-orm";

export interface PerformanceMetrics {
  totalPnl: number;
  winRate: number;
  sharpe: number;
  maxDrawdown: number;
  totalTrades: number;
  avgTradeSize: number;
  profitFactor: number;
}

/**
 * Calculate Sharpe ratio from trade PnL series.
 * Assumes daily returns, risk-free rate = 0.
 */
export function calculateSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;

  const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance =
    pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualized: assume ~252 trading days
  return (mean / stdDev) * Math.sqrt(252);
}

/**
 * Calculate max drawdown from cumulative PnL series.
 * Returns as a positive number (e.g. 0.15 = 15% drawdown).
 */
export function calculateMaxDrawdown(pnls: number[]): number {
  if (pnls.length === 0) return 0;

  let cumulative = 0;
  let peak = 0;
  let maxDD = 0;

  for (const pnl of pnls) {
    cumulative += pnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDD) maxDD = drawdown;
  }

  return peak > 0 ? maxDD / peak : 0;
}

/**
 * Calculate profit factor = gross profit / gross loss.
 */
export function calculateProfitFactor(pnls: number[]): number {
  const grossProfit = pnls.filter((p) => p > 0).reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(
    pnls.filter((p) => p < 0).reduce((s, v) => s + v, 0)
  );
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

/**
 * Compute full performance metrics for a bot.
 */
export async function computeBotMetrics(
  db: Database,
  botInstanceId: number
): Promise<PerformanceMetrics> {
  const botTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.botInstanceId, botInstanceId))
    .orderBy(trades.executedAt);

  const pnls = botTrades
    .map((t) => t.pnl)
    .filter((p): p is number => p != null);

  const totalPnl = pnls.reduce((s, v) => s + v, 0);
  const wins = pnls.filter((p) => p > 0).length;
  const winRate = pnls.length > 0 ? wins / pnls.length : 0;
  const sharpe = calculateSharpe(pnls);
  const maxDrawdown = calculateMaxDrawdown(pnls);
  const avgTradeSize =
    botTrades.length > 0
      ? botTrades.reduce((s, t) => s + t.filledSize, 0) / botTrades.length
      : 0;
  const profitFactor = calculateProfitFactor(pnls);

  return {
    totalPnl,
    winRate,
    sharpe,
    maxDrawdown,
    totalTrades: botTrades.length,
    avgTradeSize,
    profitFactor,
  };
}

/**
 * Snapshot current bot metrics to the bot_metrics table.
 */
export async function snapshotBotMetrics(
  db: Database,
  botInstanceId: number
): Promise<void> {
  const metrics = await computeBotMetrics(db, botInstanceId);

  await db.insert(botMetrics).values({
    botInstanceId,
    totalPnl: metrics.totalPnl,
    winRate: metrics.winRate,
    sharpe: metrics.sharpe,
    maxDrawdown: metrics.maxDrawdown,
    totalTrades: metrics.totalTrades,
  });
}

/**
 * Get bot leaderboard — all bots ranked by PnL.
 */
export async function getBotLeaderboard(
  db: Database
): Promise<
  Array<{
    botId: number;
    name: string;
    botType: string;
    totalPnl: number;
    winRate: number;
    sharpe: number;
  }>
> {
  const bots = await db.select().from(botInstances);
  const results = [];

  for (const bot of bots) {
    const metrics = await computeBotMetrics(db, bot.id);
    results.push({
      botId: bot.id,
      name: bot.name,
      botType: bot.botType,
      totalPnl: metrics.totalPnl,
      winRate: metrics.winRate,
      sharpe: metrics.sharpe,
    });
  }

  return results.sort((a, b) => b.totalPnl - a.totalPnl);
}
