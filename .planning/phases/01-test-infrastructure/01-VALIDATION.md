---
phase: 1
slug: test-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in, bun 1.3.10) |
| **Config file** | none — `bun test` discovers `**/*.test.ts` automatically |
| **Quick run command** | `bun test test/strategies/` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test test/strategies/`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | TEST-01 | smoke | `bun test test/core/schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | TEST-02 | unit | `bun test test/core/schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | TEST-03 | unit | `bun test test/strategies/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/helpers/db.ts` — `createTestDb()` helper using drizzle-orm/bun-sqlite/migrator
- [ ] `test/helpers/mocks.ts` — `MockExchangeClient`, `makeMockBot()`, `makeTestEnv()`, `mockAI`
- [ ] `test/core/schema.test.ts` — covers TEST-01 and TEST-02
- [ ] `test/strategies/copy-trader.test.ts` — covers TEST-03 for copy-trader
- [ ] `test/strategies/cross-arb.test.ts` — covers TEST-03 for cross-arb
- [ ] `test/strategies/deep-research.test.ts` — covers TEST-03 for deep-research
- [ ] `test/strategies/ladder-straddle.test.ts` — covers TEST-03 for ladder-straddle
- [ ] `test/strategies/llm-assessor.test.ts` — covers TEST-03 for llm-assessor
- [ ] `test/strategies/logical-arb.test.ts` — covers TEST-03 for logical-arb
- [ ] `test/strategies/market-maker.test.ts` — covers TEST-03 for market-maker
- [ ] `test/strategies/weather-arb.test.ts` — covers TEST-03 for weather-arb

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
