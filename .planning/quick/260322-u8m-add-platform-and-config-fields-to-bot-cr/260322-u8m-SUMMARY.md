---
phase: quick
plan: 260322-u8m
subsystem: ui
tags: [dashboard, bot-creation, forms, config]
dependency_graph:
  requires: []
  provides: [platform-field-in-create-form, config-json-field-in-create-form]
  affects: [src/ui/pages/Dashboard.tsx]
tech_stack:
  added: []
  patterns: [controlled-textarea-json-validation, inline-state-reset-on-success]
key_files:
  created: []
  modified:
    - src/ui/pages/Dashboard.tsx
decisions:
  - "Clear configError on textarea change (not just on submit) so error disappears as soon as user edits"
  - "Platform 'none' maps to omitting config.platform entirely, preserving cross-arb semantics"
  - "Object.assign to merge parsed JSON into config so platform field wins over any duplicate platform key in raw JSON"
metrics:
  duration: "< 5 minutes"
  completed: "2026-03-22"
  tasks: 1
  files: 1
---

# Quick Task 260322-u8m: Add Platform and Config Fields to Bot Creation Form

**One-liner:** Platform dropdown (polymarket/kalshi/none) and JSON config textarea added to bot creation form with inline validation and API payload merging.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add platform and config fields to bot creation form | b46ab87 | src/ui/pages/Dashboard.tsx |

## What Was Built

The bot creation form in `Dashboard.tsx` previously only captured bot type and name. It now includes:

- **Platform select** — three options: `polymarket`, `kalshi`, `none` (for cross-arb which operates across both exchanges). The selected value is set as `config.platform` unless "none" is chosen.
- **Config JSON textarea** — monospace, 3 rows, placeholder showing `{"tickIntervalMs": 60000, "maxPositionSize": 100}`. Parsed on submit and merged into the config object via `Object.assign`.
- **Inline validation** — if the textarea contains invalid JSON, a red error message appears below it and the Create button is disabled. Error clears as soon as the user edits the field.
- **Form reset on success** — `newBotConfig`, `newBotPlatform`, and `configError` are all reset alongside the existing `newBotName` / `showCreate` resets.

The `createBot.mutate()` call now always passes a `config` object; for cross-arb with no extra config it passes `{}`.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/ui/pages/Dashboard.tsx` exists and contains platform select and config textarea
- Commit b46ab87 is present in git log
- `npx tsc --noEmit` shows no errors attributable to Dashboard.tsx (two pre-existing errors in `src/worker/core/simulation/` are unrelated and were present before this change)
