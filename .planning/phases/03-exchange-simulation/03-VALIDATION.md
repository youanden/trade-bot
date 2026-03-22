---
phase: 3
slug: exchange-simulation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — `bun test` discovers `**/*.test.ts` automatically |
| **Quick run command** | `bun test test/core/sim-client.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test test/core/sim-client.test.ts`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | EXCH-01 | unit (type-level) | `bun test test/core/sim-client.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | EXCH-02 | unit | `bun test test/core/sim-client.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | EXCH-03 | unit | `bun test test/core/sim-client.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | EXCH-04 | unit | `bun test test/core/sim-client.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 1 | EXCH-05 | unit | `bun test test/core/sim-client.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 1 | EXCH-06 | unit | `bun test test/core/sim-client.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-07 | 01 | 1 | EXCH-07 | unit | `bun test test/core/sim-client.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/worker/core/simulation/sim-client.ts` — SimExchangeClient class + SimClientConfig interface
- [ ] `test/core/sim-client.test.ts` — covers EXCH-01 through EXCH-07
- [ ] `src/worker/core/exchanges/factory.ts` — extend with optional `simFeed` third parameter (modification, not new file)

*Existing test infrastructure `test/helpers/db.ts`, `test/helpers/mocks.ts`, and Phase 2 simulation files all present — no additional setup gaps*

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
