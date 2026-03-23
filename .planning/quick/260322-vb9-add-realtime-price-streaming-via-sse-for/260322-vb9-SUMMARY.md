---
phase: quick
plan: 260322-vb9
subsystem: markets
tags: [sse, realtime, streaming, markets, ui]
dependency_graph:
  requires: []
  provides: [GET /markets/stream SSE endpoint, useMarketStream hook]
  affects: [src/ui/pages/Markets.tsx]
tech_stack:
  added: [EventSource, ReadableStream SSE, random-walk price simulation]
  patterns: [SSE endpoint via native Response, EventSource hook with useState/useEffect/useRef]
key_files:
  created:
    - src/ui/hooks/useMarketStream.ts
  modified:
    - src/worker/api/routes/markets.ts
    - src/ui/pages/Markets.tsx
decisions:
  - SSE route placed before /:id to prevent param collision
  - priceState mutated in-place inside ReadableStream start() closure; setInterval captures the map reference
  - noPrice computed as 1 - yesPrice with toFixed(4) rounding on each tick
  - EventSource onerror handler calls es.close() to avoid reconnect loops in dev
metrics:
  duration: "~3 minutes"
  completed_date: "2026-03-22"
  tasks: 2
  files: 3
---

# Quick Task 260322-vb9: SSE realtime price streaming for Markets page

**One-liner:** SSE endpoint with random-walk tick simulation every 2s wired to a Markets page hook that overlays live prices on top of DB-seeded static data.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add GET /markets/stream SSE endpoint | 7a56470 | src/worker/api/routes/markets.ts |
| 2 | Create useMarketStream hook and wire into Markets.tsx | cff996f | src/ui/hooks/useMarketStream.ts, src/ui/pages/Markets.tsx |

## What Was Built

### SSE Endpoint (GET /api/markets/stream)

- Queries up to 50 active markets from D1
- Builds a `priceState` Map seeded from the latest prices table entries (ISO-8601 lexicographic comparison for latest timestamp)
- On connect: sends a `snapshot` event with all active market prices
- Every 2000ms: picks a random market, applies a bounded random-walk delta (`(Math.random() - 0.5) * 0.04`), clamps to `[0.01, 0.99]`, emits a `tick` event
- Auto-closes after 10 minutes to prevent zombie connections
- Returns native `Response` with `Content-Type: text/event-stream` (not Hono `c.json()`)
- Placed before `/:id` route to prevent Hono param collision

### useMarketStream Hook

- Creates `EventSource("/api/markets/stream")` on mount
- `snapshot` listener: parses JSON array, builds fresh `Map<number, PriceOverride>`
- `tick` listener: clones prev Map, updates single entry (avoids mutation of state)
- `onerror`: calls `es.close()` to stop reconnection loops
- Cleanup: closes EventSource on unmount
- Returns `Map<number, PriceOverride>` where `PriceOverride = { yesPrice, noPrice }`

### Markets.tsx Integration

- Calls `useMarketStream()` after `useMarkets(200)`
- In `filtered.map()`: resolves `yesPrice`/`noPrice` via `priceOverrides.get(m.id)?.yesPrice ?? m.yesPrice`
- DB prices remain as fallback before snapshot arrives
- 30s refetchInterval on `useMarkets` retained as long-term data sync

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - prices are simulated via random walk from real seeded values, not hardcoded placeholders.

## Self-Check: PASSED

- `src/worker/api/routes/markets.ts` - FOUND with /stream route added
- `src/ui/hooks/useMarketStream.ts` - FOUND, new file
- `src/ui/pages/Markets.tsx` - FOUND, wired to useMarketStream
- Commits 7a56470 and cff996f - FOUND in git log
