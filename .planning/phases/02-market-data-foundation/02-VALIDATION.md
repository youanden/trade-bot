---
phase: 2
slug: market-data-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — `bun test` discovers `**/*.test.ts` automatically |
| **Quick run command** | `bun test test/core/generator.test.ts test/core/feed.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test test/core/generator.test.ts test/core/feed.test.ts`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | DATA-07 | unit | `bun test test/core/generator.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | DATA-01 | unit | `bun test test/core/generator.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | DATA-02 | unit | `bun test test/core/generator.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | DATA-03 | unit | `bun test test/core/generator.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | DATA-04 | unit | `bun test test/core/generator.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 1 | DATA-05 | unit | `bun test test/core/generator.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-07 | 01 | 1 | DATA-06 | integration | `bun test test/core/generator.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | — | unit | `bun test test/core/feed.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | — | unit | `bun test test/core/feed.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/worker/core/simulation/prng.ts` — mulberry32 PRNG factory
- [ ] `src/worker/core/simulation/types.ts` — ScenarioType, GeneratorParams, GeneratedScenario types
- [ ] `src/worker/core/simulation/generator.ts` — generateScenario() function
- [ ] `src/worker/core/simulation/feed.ts` — PriceFeed class
- [ ] `test/core/generator.test.ts` — covers DATA-01 through DATA-07
- [ ] `test/core/feed.test.ts` — covers no-lookahead cursor enforcement

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visually plausible price trajectories | DATA-01..DATA-05 | Visual assessment of chart shape | Generate all 5 scenarios with seed 42, 200 ticks; plot or print min/max/trend; confirm trajectories are distinguishable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
