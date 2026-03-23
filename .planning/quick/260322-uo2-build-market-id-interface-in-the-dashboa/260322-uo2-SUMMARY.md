---
phase: quick
plan: 260322-uo2
subsystem: ui,api
tags: [bot-config, market-ids, patch-endpoint, bot-detail]
dependency_graph:
  requires: []
  provides: [PATCH /api/bots/:id/config, MarketIds editor UI]
  affects: [src/worker/api/routes/bots.ts, src/ui/lib/api.ts, src/ui/hooks/useBots.ts, src/ui/pages/BotDetail.tsx]
tech_stack:
  added: []
  patterns: [useMutation + invalidateQueries, partial config merge via spread]
key_files:
  created: []
  modified:
    - src/worker/api/routes/bots.ts
    - src/ui/lib/api.ts
    - src/ui/hooks/useBots.ts
    - src/ui/pages/BotDetail.tsx
decisions:
  - Config merge uses spread operator on existing config to preserve unmodified fields
  - marketIds extracted with Array.isArray guard to safely handle missing/malformed config
metrics:
  duration: ~5 minutes
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 4
---

# Quick Task 260322-uo2: Build Market ID Interface in the Dashboard — Summary

**One-liner:** Interactive marketIds editor on BotDetail page backed by PATCH /api/bots/:id/config partial-merge endpoint.

## What Was Built

Added a complete market ID management flow:

1. **API layer** — `PATCH /:id/config` route in `bots.ts` loads the existing bot config, merges the request body via spread, writes back via `.returning()`, and returns the updated row.

2. **Client layer** — `api.updateBotConfig(id, config)` method in `api.ts` wraps the PATCH call.

3. **Hook layer** — `useUpdateBotConfig(id)` hook in `useBots.ts` wraps the mutation and invalidates `["bots", id]` on success.

4. **UI layer** — New Market IDs card in `BotDetail.tsx`:
   - Displays current marketIds as pill tags with monospace truncated text and an x button
   - Text input accepts new IDs via typing + Enter key or clicking Add button
   - Disabled states during pending mutations
   - Error message displayed on failure
   - Card placed full-width between the 2-column grid and Recent Trades section

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add PATCH config endpoint and API client method | 908dfbd | bots.ts, api.ts, useBots.ts |
| 2 | Add MarketIds editor to BotDetail page | 245d07d | BotDetail.tsx |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data is wired to the live API. The marketIds field reads directly from `bot.config` which is persisted in D1.

## Self-Check: PASSED

- `src/worker/api/routes/bots.ts` — modified, contains `app.patch("/:id/config"` handler
- `src/ui/lib/api.ts` — modified, contains `updateBotConfig` method
- `src/ui/hooks/useBots.ts` — modified, exports `useUpdateBotConfig`
- `src/ui/pages/BotDetail.tsx` — modified, contains `Market IDs` card with `marketIds` handling
- Commits 908dfbd and 245d07d exist in git log
- No TypeScript errors in modified files
