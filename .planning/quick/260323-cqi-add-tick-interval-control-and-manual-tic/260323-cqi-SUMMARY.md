---
phase: quick-260323-cqi
plan: 01
subsystem: bots-ui
tags: [tick-control, manual-tick, live-config, durable-objects, ui]
dependency_graph:
  requires: []
  provides: [forceTick-rpc, tick-interval-control, live-config-update]
  affects: [src/worker/bots/base.ts, src/worker/api/routes/bots.ts, src/ui/lib/api.ts, src/ui/hooks/useBots.ts, src/ui/pages/BotDetail.tsx]
tech_stack:
  added: []
  patterns: [DO-RPC-method, alarm-reschedule-on-config, mutation-hook]
key_files:
  created: []
  modified:
    - src/worker/bots/base.ts
    - src/worker/api/routes/bots.ts
    - src/ui/lib/api.ts
    - src/ui/hooks/useBots.ts
    - src/ui/pages/BotDetail.tsx
decisions:
  - forceTick does not reschedule the alarm — the existing alarm loop continues independently; only the on-demand tick fires
  - Alarm reschedule in updateConfig uses deleteAlarm + setAlarm pattern to reset the countdown from the moment config is saved
metrics:
  duration: ~10 minutes
  completed: "2026-03-23T13:13:54Z"
  tasks_completed: 2
  files_modified: 5
---

# Quick Task 260323-cqi: Add Tick Interval Control and Manual Tick Summary

**One-liner:** Editable tickIntervalMs field and Trigger Tick button wired through new `forceTick` DO RPC and live config forwarding to running bots.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add forceTick RPC, alarm reschedule on updateConfig, POST /tick route | 5f42694 | base.ts, routes/bots.ts |
| 2 | Add tickIntervalMs form field, Trigger Tick button, useForceTick hook | 3db369b | api.ts, useBots.ts, BotDetail.tsx |

## What Was Built

### Worker Changes (base.ts)

- `forceTick()` public async RPC method: guards on `!this.config`, calls `this.tick()` directly, increments `tickCount`, sets `lastTick`, clears `lastError`, writes audit log entry `"force-tick"`. Does NOT reschedule the alarm — the existing alarm loop runs independently.
- `updateConfig()` extended: after persisting config, if `this.running && partial.tickIntervalMs !== undefined`, deletes current alarm and schedules a new one at `Date.now() + this.config.tickIntervalMs` so the interval change takes effect immediately.

### API Route Changes (routes/bots.ts)

- `POST /:id/tick` route added (between stop and status routes): fetches bot from DB, validates DO ID exists, gets stub, calls `stub.forceTick()`, returns `{ ok: true }`.
- `PATCH /:id/config` updated: after DB merge, if bot has `durableObjectId` and `status === "running"`, gets stub and calls `stub.updateConfig(body)` to push changes to the live DO.

### UI Changes

- `api.ts`: `forceTick(id)` method targets `POST /bots/${id}/tick`.
- `useBots.ts`: `useForceTick(id)` mutation hook invalidates `["bots", id, "status"]` on success.
- `BotDetail.tsx`:
  - `ConfigFormState` gains `tickIntervalMs: number`
  - `configToFormState` maps `config?.tickIntervalMs ?? 60000`
  - `isDirty` comparison includes `tickIntervalMs`
  - Tick Interval (ms) input field (step 1000, min 1000) added after Platform select in config grid
  - "Trigger Tick" button added in header button group, visible only when `bot.status === "running"`, shows "Ticking..." while pending

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data is wired to real endpoints.

## Self-Check: PASSED

Files exist:
- src/worker/bots/base.ts — FOUND (contains `async forceTick`)
- src/worker/api/routes/bots.ts — FOUND (contains `/:id/tick`)
- src/ui/pages/BotDetail.tsx — FOUND (contains `tickIntervalMs`)

Commits exist:
- 5f42694 — FOUND
- 3db369b — FOUND
