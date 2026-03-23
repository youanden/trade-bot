---
phase: quick
plan: 260323-cdq
subsystem: ui
tags: [react, forms, bot-config, market-maker]
dependency_graph:
  requires: []
  provides: [editable-bot-config-form]
  affects: [src/ui/pages/BotDetail.tsx]
tech_stack:
  added: []
  patterns: [controlled-form-state, dirty-tracking, useMemo-comparison, useEffect-reset]
key_files:
  modified:
    - src/ui/pages/BotDetail.tsx
decisions:
  - Local marketIds state updated on add/remove; single Save button submits all config together
  - isDirty computed via useMemo comparison to original bot.config values for reliable enable/disable of Save
  - useEffect keyed on bot.config to reset form state after server refetch
metrics:
  duration: "~3 minutes"
  completed: "2026-03-23T12:57:33Z"
  tasks_completed: 1
  files_modified: 1
---

# Phase quick Plan 260323-cdq: Add Strategy Config Edit Form to BotDetail Summary

**One-liner:** Inline editable market-maker config form (platform select + 6 number inputs + market IDs chips) with dirty-tracking Save button replacing read-only JSON card and separate Market IDs section.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Replace config card and Market IDs section with editable Configuration form | e20c83e | src/ui/pages/BotDetail.tsx |

## What Was Built

Replaced two separate read-only sections in BotDetail.tsx:
- The "Configuration" card showing raw `JSON.stringify(bot.config)` in a `<pre>` block
- The standalone "Market IDs" section with its own save-on-change handlers

With a single unified "Configuration" form card containing:
- `ConfigFormState` interface and `configToFormState()` helper function
- `useState` for form fields (platform, spreadWidth, orderSize, maxInventory, levels, maxMarkets, minVolume) initialized from bot.config
- `useState` for local marketIds list (add/remove without server round-trips)
- `useEffect` keyed on `bot.config` to reset form when server data refreshes
- `useMemo`-based `isDirty` flag comparing current form state against original bot.config values
- Grid layout (md:grid-cols-2) with labeled inputs: `<select>` for platform, `<input type="number">` for all numeric fields
- Market IDs chip UI embedded within the same card (chips with remove buttons, text input with Enter key support and Add button)
- Single Save button calling `updateConfig.mutate({ ...bot.config, ...formState, marketIds })`, disabled when not dirty or mutation pending
- Error message when `updateConfig.isError`

Header, Live Status card, and Recent Trades sections remain completely unchanged.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all form fields are wired to live bot.config data from the server.

## Self-Check: PASSED

- [x] `src/ui/pages/BotDetail.tsx` exists and was modified
- [x] Commit `e20c83e` exists (`git log --oneline | grep e20c83e`)
- [x] `npx tsc -p tsconfig.json --noEmit` shows zero errors in BotDetail.tsx
