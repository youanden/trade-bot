---
phase: 01-test-infrastructure
plan: "01"
subsystem: test-infrastructure
tags: [test-helpers, in-memory-sqlite, mocks, schema-verification]
dependency_graph:
  requires: []
  provides:
    - createTestDb — in-memory SQLite with full production schema via drizzle migrate
    - MockExchangeClient — full ExchangeClient interface stub with controllable state
    - makeMockBot — duck-typed BaseBotDO shape safe outside Wrangler
    - makeTestEnv — minimal Env stub for strategy tests
    - mockAI — Workers AI binding stub for LLM strategies
  affects:
    - All subsequent plans in Phase 1 (strategy tick tests depend on createTestDb and mocks)
    - Phase 4 (SimulatedBot duck-typing pattern validated here)
tech_stack:
  added:
    - drizzle-orm/bun-sqlite — bun:sqlite adapter for Drizzle (test-only; production uses drizzle-orm/d1)
    - drizzle-orm/bun-sqlite/migrator — synchronous migrate() for in-memory DB setup
  patterns:
    - migrate() called synchronously (bun:sqlite; NOT awaited unlike some other adapters)
    - db.$client.query() for raw SQL access to underlying bun:sqlite Database
key_files:
  created:
    - test/helpers/db.ts
    - test/helpers/mocks.ts
    - test/core/schema.test.ts
  modified: []
decisions:
  - "Use drizzle-orm/bun-sqlite (not drizzle-orm/d1) for test DB — matches D1 SQLite semantics without Wrangler runtime"
  - "MockExchangeClient stores placedOrders as array for test assertions — avoids need for spy/mock libraries"
  - "makeMockBot uses Record<string, unknown> config to avoid importing BaseBotDO (cloudflare:workers unavailable in bun test)"
  - "makeTestEnv returns Record<string, unknown> not Env — avoids Cloudflare type imports in test scope"
metrics:
  duration: "< 1 minute"
  completed: "2026-03-21"
  tasks_completed: 2
  files_created: 3
---

# Phase 01 Plan 01: Test Helpers and Schema Verification Summary

In-memory SQLite test infrastructure using drizzle-orm/bun-sqlite with synchronous migrate(), plus MockExchangeClient, makeMockBot, makeTestEnv, and mockAI stubs that let strategy tests run without Wrangler or real exchange credentials.

## What Was Built

### Task 1 — Test Helpers (test/helpers/db.ts, test/helpers/mocks.ts)

`createTestDb()` opens a `bun:sqlite` `:memory:` database, wraps it with Drizzle using the production schema, and runs `migrate()` synchronously from `./drizzle`. Returns a fully typed Drizzle instance.

`MockExchangeClient` implements all 10 methods of the `ExchangeClient` interface. Stores placed orders in `placedOrders[]` for assertion, supports configurable `priceMap`, `markets`, and `balance`.

`makeMockBot()` duck-types the `BaseBotDO` fields that strategies read: `config`, `recordTrade()`, `getStatus()`. Uses `Record<string, unknown>` to avoid importing `BaseBotDO` (extends `DurableObject` from `cloudflare:workers`, which is unavailable outside Wrangler).

`makeTestEnv()` builds a minimal `Env`-shaped object with `DB`, `BOT_DO`, `ASSETS`, and `ENVIRONMENT`. Omits exchange credentials so strategies early-return on `createExchangeClient` failure rather than crashing.

`mockAI` stubs `env.AI.run()` returning `{ response: JSON.stringify({ probability: 0.6, reasoning: "mock analysis" }) }` — matching what both LLM strategies parse.

### Task 2 — Schema Verification Test (test/core/schema.test.ts)

Three tests:
1. All 10 production tables exist in the in-memory DB (filters `sqlite_%` and `__drizzle%` tables via `sqlite_master`)
2. `markets` table has expected snake_case columns (`platform_id`, `created_at`, `updated_at`, etc.)
3. `bot_instances` table has expected columns (`bot_type`, `config`, `status`)

Result: `bun test test/core/schema.test.ts` — 3 pass, 0 fail. Full `bun test test/core/` — 25 pass, 0 fail (includes existing kelly, analytics, matcher tests).

## Verification

```
bun test test/core/schema.test.ts
 3 pass, 0 fail in 38ms

bun test test/core/
 25 pass, 0 fail in 28ms
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all exports are functional implementations, not placeholders.

## Self-Check: PASSED
