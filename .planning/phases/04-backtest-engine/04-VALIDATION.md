---
phase: 4
slug: backtest-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 04-01-01 | 01 | 1 | BT-01 | unit | `bun test` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | BT-02 | unit | `bun test` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | BT-03 | unit | `bun test` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | BT-04 | unit | `bun test` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | BT-05 | unit | `bun test` | ❌ W0 | ⬜ pending |
| 04-01-06 | 01 | 1 | BT-06 | unit | `bun test` | ❌ W0 | ⬜ pending |
| 04-01-07 | 01 | 1 | BT-07 | unit | `bun test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/backtest/engine.test.ts` — core engine tests for BT-01, BT-02, BT-03
- [ ] `test/backtest/isolation.test.ts` — DB isolation tests for BT-04
- [ ] `test/backtest/circuit-breaker.test.ts` — multi-day circuit breaker for BT-05
- [ ] `test/backtest/llm-mock.test.ts` — LLM strategy mock tests for BT-06
- [ ] `test/backtest/all-strategies.test.ts` — all 8 strategies tick test for BT-07

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
