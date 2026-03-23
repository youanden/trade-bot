---
phase: quick
plan: 260322-wb2
subsystem: exchanges/kalshi
tags: [bug-fix, kalshi, api-compatibility]
dependency_graph:
  requires: []
  provides: [kalshi-active-status-mapping]
  affects: [market-maker-strategy, kalshi-market-discovery]
tech_stack:
  added: []
  patterns: [api-vocabulary-translation-at-client-boundary]
key_files:
  modified:
    - src/worker/core/exchanges/kalshi/client.ts
decisions:
  - "Map 'active' -> 'open' in KalshiClient.getMarkets query param; Kalshi API uses 'open' in requests but 'active' in response objects"
metrics:
  duration: "< 1 min"
  completed: "2026-03-22"
---

# Quick Task 260322-wb2: Fix Kalshi getMarkets Status Filter Map Summary

**One-liner:** Map internal "active" status to Kalshi API's "open" query param in KalshiClient.getMarkets to fix HTTP 400 rejections.

## What Was Done

Added a status vocabulary translation in `KalshiClient.getMarkets` (line 42 of `src/worker/core/exchanges/kalshi/client.ts`). The Kalshi REST API uses `status=open` in query parameters but returns `"active"` in response objects. Without the mapping, callers passing `status: "active"` received HTTP 400 errors. The fix translates at the client boundary so all callers (e.g., market-maker strategy) continue passing `"active"` unchanged.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Map "active" to "open" in getMarkets query params | ef54151 |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- File modified: `src/worker/core/exchanges/kalshi/client.ts` — FOUND
- Commit ef54151 — FOUND
