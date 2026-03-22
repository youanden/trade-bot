# Trade Bot — Simulation & Testing

## What This Is

A simulation and testing layer for an existing Cloudflare Workers trading bot platform. Adds seeders that populate all 8 bot types with realistic configurations, market data, and trade history, plus a backtest engine and paper trading mode to evaluate strategy performance across different market conditions. Results are reported via CLI.

## Core Value

Confidently evaluate and compare all 8 trading strategies against realistic market scenarios before risking real capital.

## Requirements

### Validated

- ✓ 8 trading strategies implemented (cross-arb, copy-trader, deep-research, ladder-straddle, llm-assessor, logical-arb, market-maker, weather-arb) — existing
- ✓ Unified ExchangeClient interface for Polymarket and Kalshi — existing
- ✓ D1/Drizzle schema for markets, prices, bots, orders, trades, positions — existing
- ✓ PortfolioRisk and Kelly criterion risk management — existing
- ✓ React dashboard with TanStack Query — existing

### Active

- [ ] Seeder for all 8 bot types with valid configs, market data, and pre-populated trades/positions
- [x] Market data generator for bull, bear, and flat trend patterns — Validated in Phase 02: market-data-foundation
- [x] Market data generator for volatile and crash scenarios — Validated in Phase 02: market-data-foundation
- [ ] Real market data capture and replay from Polymarket/Kalshi
- [ ] Backtest engine that replays market data through strategies and measures performance
- [ ] Paper trading mode that runs bots against real data with simulated balances
- [ ] CLI performance report (PnL, Sharpe ratio, drawdown, win rate) per strategy per scenario
- [ ] Strategy comparison across scenarios in CLI output
- [x] Unit tests for strategy logic with in-memory SQLite — Validated in Phase 01: test-infrastructure
- [ ] Integration tests on Wrangler dev with D1 local

### Out of Scope

- Dashboard/UI for simulation results — CLI report is sufficient for now
- Cross-platform arb spread generation — focusing on directional trends first, arb scenarios deferred
- Modifying existing strategy logic — testing existing strategies as-is
- Production deployment of simulation — dev/test only

## Context

- Existing codebase is a Cloudflare Workers monorepo with Hono API + React SPA
- All strategies are stateless tick functions conforming to `StrategyTickFn = (bot: BaseBotDO, env: Env) => Promise<void>`
- Each bot runs as a Durable Object with alarm-driven tick loop
- Dual-platform: Polymarket (EVM/CLOB) and Kalshi (REST) behind unified `ExchangeClient` interface
- Database: Cloudflare D1 (SQLite) via Drizzle ORM with tables for markets, prices, bot_instances, orders, trades, positions
- Test infrastructure: bun:test with 88 tests across 15 files
- SimExchangeClient implements full ExchangeClient interface with Polymarket/Kalshi fee simulation, partial fills, and virtual balance
- Factory extended: `createExchangeClient(env, platform, simFeed?)` returns SimExchangeClient when simFeed provided
- Paper trading needs a similar mock but consuming live market feeds

## Constraints

- **Runtime**: Must work within Cloudflare Workers constraints (no Node.js-only APIs in production code)
- **Testing Runtime**: Vitest + in-memory SQLite for unit tests, Wrangler dev for integration
- **Data**: Market data generators must produce data compatible with existing `markets`, `prices`, and exchange response schemas
- **Strategy Interface**: Simulation must exercise strategies through their existing `StrategyTickFn` interface without modification

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| CLI report over dashboard | Faster iteration, less scope, can always add UI later | — Pending |
| Mock ExchangeClient for backtest | Strategies already use interface; swap implementation for simulation | ✓ Validated Phase 03 |
| In-memory SQLite for unit tests | Matches D1 SQLite semantics without needing Wrangler | ✓ Validated Phase 01 |
| Defer arb spread scenarios | Directional trends cover most strategies; arb spreads add complexity | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-22 after Phase 03 completion*
