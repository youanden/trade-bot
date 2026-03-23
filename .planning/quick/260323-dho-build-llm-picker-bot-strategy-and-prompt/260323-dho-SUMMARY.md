---
phase: quick
plan: 260323-dho
subsystem: bots, api, ui
tags: [llm, strategy, prompt-testing, ai, cloudflare-workers-ai]
dependency_graph:
  requires: []
  provides: [llm-picker-strategy, prompt-test-api, prompt-tester-ui]
  affects: [registry, index.ts, App.tsx]
tech_stack:
  added: []
  patterns: [strategy-tick-pattern, hono-route-module, tanstack-query-mutation]
key_files:
  created:
    - src/worker/bots/llm-picker/config.ts
    - src/worker/bots/llm-picker/strategy.ts
    - src/worker/api/routes/promptTest.ts
    - src/ui/pages/PromptTester.tsx
  modified:
    - src/worker/bots/registry.ts
    - src/worker/index.ts
    - src/ui/App.tsx
    - src/ui/lib/api.ts
decisions:
  - interpolatePrompt exported from strategy.ts and imported in promptTest.ts to share prompt interpolation logic without duplication
  - parsePickerResponse exported from strategy.ts for reuse in API route result parsing
  - confidence threshold of 0.5 used in strategy (skip trade if LLM has less than 50% confidence)
  - marketIds in strategy resolved by calling getMarkets and filtering by platformId (exchange client has no getMarket-by-id in batch form)
metrics:
  duration: "~8 minutes"
  completed_date: "2026-03-23"
  tasks_completed: 2
  files_changed: 8
---

# Quick Task 260323-dho: LLM Picker Bot Strategy and Prompt Tester

**One-liner:** LLM picker strategy using configurable prompt templates to pick yes/no on prediction markets, plus a PromptTester UI sandbox with market selector, 3 preset prompts, and structured result cards.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create llm-picker strategy with configurable prompt template and register it | a2f128a | config.ts, strategy.ts, registry.ts |
| 2 | Create prompt-test API endpoint and Prompt Tester UI page | 4919742 | promptTest.ts, index.ts, PromptTester.tsx, App.tsx, api.ts |

## What Was Built

### llm-picker Strategy (`src/worker/bots/llm-picker/`)

**config.ts** — `LlmPickerConfig` extends `BotConfig` with:
- `promptTemplate: string` — user-editable with `{{title}}`, `{{description}}`, `{{yesPrice}}`, `{{noPrice}}`, `{{category}}`, `{{endDate}}` placeholders
- `aiModel: string` — defaults to `@cf/meta/llama-3-8b-instruct`
- `marketIds?: string[]` — optional list of specific platform market IDs; if empty, discovers active markets
- `maxMarkets?: number` — max markets per tick (default 5)
- `maxPositionSize: number` — max contracts per trade (default 100)

**strategy.ts** — `llmPickerTick` follows the llm-assessor pattern:
1. Checks daily loss circuit breaker
2. Guards on `env.AI` presence
3. Resolves markets from config or via exchange discovery
4. For each market: fetches price, interpolates prompt, calls Workers AI, parses `{pick, confidence, reasoning}` JSON response
5. Skips trades with confidence < 0.5
6. Runs risk check via `PortfolioRisk.checkTrade()`
7. Places order and records trade with reason `llm-picker:pick=yes:conf=0.87`

Two exported helpers shared with the API route:
- `interpolatePrompt(template, vars)` — replaces all `{{placeholder}}` tokens
- `parsePickerResponse(response)` — extracts `{pick, confidence, reasoning}` from LLM JSON response

### Prompt Test API (`src/worker/api/routes/promptTest.ts`)

`POST /api/prompt-test` accepts `{ marketIds: number[], prompt: string, aiModel?: string }`:
- Validates AI binding exists (400 if not)
- Validates non-empty marketIds and prompt
- For each marketId: queries `markets` table, fetches latest price from `prices`, interpolates prompt, calls `env.AI.run()`
- Returns array: `[{ marketId, title, yesPrice, noPrice, prompt: interpolated, response: rawText, parsed: {...} | null }]`

### PromptTester UI (`src/ui/pages/PromptTester.tsx`)

Three-section layout:

**Section A — Market Selector:** Scrollable checkbox list (max-h-64) with platform badges, yes/no prices, Select All / Deselect All buttons, selected count display.

**Section B — Prompt Editor:** 3 preset buttons (Default Picker, Probability Assessor, Risk Analyst), monospace textarea (min-h-200px), placeholder hint text, AI model text input, primary Run button disabled when no markets selected or prompt empty.

**Section C — Results:** Loading spinner during mutation, error banner on failure, one card per market showing: pick/confidence/reasoning as colored badge, collapsible `<details>` for interpolated prompt, pre/code block for raw LLM response, red "Parse failed" message when parsing returns null.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data is wired through real API calls and DB queries.

## Self-Check: PASSED

- `src/worker/bots/llm-picker/config.ts` — FOUND
- `src/worker/bots/llm-picker/strategy.ts` — FOUND
- `src/worker/api/routes/promptTest.ts` — FOUND
- `src/ui/pages/PromptTester.tsx` — FOUND
- Commit `a2f128a` — FOUND
- Commit `4919742` — FOUND
- TypeScript: 0 errors from new files (2 pre-existing simulation errors unrelated to this work)
