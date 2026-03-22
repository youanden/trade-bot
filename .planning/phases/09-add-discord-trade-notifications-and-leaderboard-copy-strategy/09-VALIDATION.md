---
phase: 09
slug: add-discord-trade-notifications-and-leaderboard-copy-strategy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in Bun test runner) |
| **Config file** | none — bun discovers `test/**/*.test.ts` via `bun test` |
| **Quick run command** | `bun test test/core/discord.test.ts test/core/leaderboard.test.ts test/strategies/copy-trader.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test test/core/discord.test.ts test/core/leaderboard.test.ts test/strategies/copy-trader.test.ts`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | DISC-01 | unit | `bun test test/core/discord.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | DISC-02 | unit | `bun test test/core/discord.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | DISC-03 | unit | `bun test test/core/discord.test.ts` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 1 | DISC-04 | unit | `bun test test/strategies/copy-trader.test.ts` | ✅ extend | ⬜ pending |
| 09-03-01 | 03 | 2 | LEAD-01 | unit | `bun test test/core/leaderboard.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-02 | 03 | 2 | LEAD-02 | unit | `bun test test/strategies/copy-trader.test.ts` | ✅ extend | ⬜ pending |
| 09-03-03 | 03 | 2 | LEAD-03 | unit | `bun test test/strategies/copy-trader.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/core/discord.test.ts` — stubs for DISC-01, DISC-02, DISC-03
- [ ] `test/core/leaderboard.test.ts` — stubs for LEAD-01

*Existing `test/strategies/copy-trader.test.ts` is extended for DISC-04, LEAD-02, LEAD-03 — no new file needed*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Discord message renders correctly in channel | DISC-03 | Visual formatting | Post to test webhook, verify emoji/embed layout in Discord |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
