---
phase: quick
plan: 260323-cut
subsystem: ui, worker-api, bot-do
tags: [audit-logging, ui, bots, logs-panel, error-visibility]
dependency_graph:
  requires: []
  provides: [tick-audit-logging, bot-logs-api, recent-logs-panel, error-banner]
  affects: [src/worker/bots/base.ts, src/worker/api/routes/bots.ts, src/ui/pages/BotDetail.tsx]
tech_stack:
  added: []
  patterns: [polling-with-refetchInterval, audit-log-reads, drizzle-orderBy-desc]
key_files:
  created: []
  modified:
    - src/worker/bots/base.ts
    - src/worker/api/routes/bots.ts
    - src/ui/lib/api.ts
    - src/ui/hooks/useBots.ts
    - src/ui/pages/BotDetail.tsx
decisions:
  - Split force-tick audit into force-tick:success and force-tick:error entries for parity with alarm tick logging
metrics:
  duration: ~60s
  completed: "2026-03-23"
  tasks_completed: 2
  files_modified: 5
---

# Quick 260323-cut: Add Recent Logs Panel to BotDetail Page — Summary

**One-liner:** Tick-level audit logging (tick:success / tick:error) written to DB on every alarm cycle, exposed via GET /api/bots/:id/logs, and rendered as a scrollable auto-refreshing log panel with red-highlighted error entries and a persistent error banner on BotDetail.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add tick audit logging and GET /api/bots/:id/logs endpoint | 0b0e4af | base.ts, bots.ts |
| 2 | Add logs panel and error banner to BotDetail page | 34eba4e | api.ts, useBots.ts, BotDetail.tsx |

## What Was Built

### Task 1: Tick Audit Logging + Logs API

**src/worker/bots/base.ts**
- Added `await this.audit("tick:success", { tickCount })` in `alarm()` success path after clearing lastError
- Added `await this.audit("tick:error", { error: msg, tickCount })` in `alarm()` catch block after DB errorMessage update
- Replaced unconditional `await this.audit("force-tick")` in `forceTick()` with conditional `force-tick:success` / `force-tick:error` entries matching the same pattern

**src/worker/api/routes/bots.ts**
- Added `auditLog` to schema import and `desc` to drizzle-orm import
- Added `GET /:id/logs` route: queries audit_log filtered by botInstanceId, ordered newest first, configurable limit (default 50, max 200)

### Task 2: BotDetail UI

**src/ui/lib/api.ts**
- Added `getBotLogs(id, limit?)` method calling `GET /bots/:id/logs`

**src/ui/hooks/useBots.ts**
- Added `useBotLogs(id)` hook with `refetchInterval: 5000` for auto-refresh

**src/ui/pages/BotDetail.tsx**
- Imported and wired `useBotLogs` hook
- Added persistent error banner (red-tinted border + bg) shown when `bot.error_message` is set
- Added "Recent Logs" panel after the trades table with:
  - `max-h-80` scrollable container
  - Monospace font, timestamp (time only), action name, flattened key=value details
  - Red background highlight for entries where `action.includes("error")`
  - "No logs yet." empty state

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

All modified files exist. Both task commits (0b0e4af, 34eba4e) confirmed in git log.
