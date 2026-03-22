---
phase: 4
slug: backtest-engine
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-21
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (via bun) |
| **Config file** | `vite.config.ts` |
| **Quick run command** | `bun test` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | BT-03 | unit | `bun test test/core/sim-bot.test.ts` | W0: test/core/sim-bot.test.ts | ⬜ pending |
| 04-01-02 | 01 | 1 | BT-04 | unit | `bun test test/core/sim-bot.test.ts` | W0: test/core/sim-bot.test.ts | ⬜ pending |
| 04-02-01 | 02 | 2 | BT-01 | unit | `bun test test/core/engine.test.ts` | W0: test/core/engine.test.ts | ⬜ pending |
| 04-02-02 | 02 | 2 | BT-02 | integration | `bun test test/core/engine.test.ts` | W0: test/core/engine.test.ts | ⬜ pending |
| 04-02-03 | 02 | 2 | BT-04 | integration | `bun test test/core/engine.test.ts` | W0: test/core/engine.test.ts | ⬜ pending |
| 04-02-04 | 02 | 2 | BT-05 | integration | `bun test test/core/engine.test.ts` | W0: test/core/engine.test.ts | ⬜ pending |
| 04-02-05 | 02 | 2 | BT-06 | integration | `bun test test/core/engine.test.ts` | W0: test/core/engine.test.ts | ⬜ pending |
| 04-02-06 | 02 | 2 | BT-07 | integration | `bun test test/core/engine.test.ts` | W0: test/core/engine.test.ts | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/core/sim-bot.test.ts` — SimulatedBot unit tests (BT-03) and PortfolioRisk clock tests (BT-04), created by Plan 01 Task 1
- [x] `test/core/engine.test.ts` — BacktestClock (BT-01), engine integration (BT-02), circuit breaker day reset (BT-04), DB isolation (BT-05), equity curve (BT-06), LLM mock (BT-07), created by Plan 02 Task 1

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
