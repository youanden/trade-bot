---
phase: quick
plan: 260322-jcc
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/ROADMAP.md
  - .planning/phases/09-add-discord-trade-notifications-and-leaderboard-copy-strategy/09-CONTEXT.md
autonomous: true
requirements: []
must_haves:
  truths:
    - "ROADMAP.md phase 09 has a concrete goal reflecting Discord webhook notifications and leaderboard copy strategy"
    - "ROADMAP.md phase 09 has defined requirement IDs (not TBD)"
    - "Phase 09 CONTEXT.md captures the Discord webhook approach decision and discordeno fallback decision"
  artifacts:
    - path: ".planning/ROADMAP.md"
      provides: "Updated phase 09 section with goal, requirements, success criteria"
      contains: "Discord webhook"
    - path: ".planning/phases/09-add-discord-trade-notifications-and-leaderboard-copy-strategy/09-CONTEXT.md"
      provides: "Phase context with locked decisions on Discord integration approach"
      contains: "discordeno"
  key_links: []
---

<objective>
Update phase 09 planning docs to define the goal, requirements, success criteria, and a CONTEXT.md
capturing two key architectural decisions: (1) Discord webhooks for trade notifications via simple
fetch POST from Workers, and (2) discordeno as the Discord library if interactive bot features are
needed later.

Purpose: Lock in decisions so future plan-phase execution has clear direction.
Output: Updated ROADMAP.md phase 09 section + new 09-CONTEXT.md
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/todos/done/2026-03-22-add-discord-trade-notifications-and-leaderboard-copy-strategy.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update ROADMAP.md phase 09 section with goal, requirements, and success criteria</name>
  <files>.planning/ROADMAP.md</files>
  <action>
Read .planning/ROADMAP.md. Replace lines 143-151 (the phase 09 section) with a fully specified
phase entry. Use the existing phase format (see phases 1-7 for examples).

**Goal:** Trade execution events post formatted notifications to Discord via webhook, and the
copy trader strategy dynamically selects traders from the Polymarket leaderboard API

**Requirements** (define these IDs):
- DISC-01: Discord webhook notification service that formats trade events (COPY BUY/SELL, TAKE PROFIT, STOP LOSS) into emoji-rich messages and POSTs via fetch
- DISC-02: Webhook URL stored as Cloudflare Workers secret binding (DISCORD_WEBHOOK_URL)
- DISC-03: Message format includes trade type, market name, outcome, price, shares, cost, fees, P&L on sells, trader address (abbreviated), timestamp, portfolio summary footer
- DISC-04: Notification service integrated into copy trader strategy trade execution flow
- LEAD-01: Polymarket leaderboard API client to fetch top trader rankings and performance metrics
- LEAD-02: Copy trader strategy uses leaderboard data to dynamically update tracked_traders list
- LEAD-03: Leaderboard refresh interval configurable in bot config

**Success Criteria** (4-5 items, testable):
1. Executing a copy trade in simulation posts a formatted Discord message containing trade type emoji, market name, price, and P&L to a test webhook URL
2. The webhook URL is read from env.DISCORD_WEBHOOK_URL binding — no hardcoded URLs exist in source
3. The leaderboard client fetches current top traders from Polymarket API and returns them as TrackedTrader-compatible records
4. A copy trader bot configured with leaderboard mode automatically refreshes its tracked trader list at the configured interval
5. All Discord notification code uses native fetch (no external Discord library) and runs within Cloudflare Workers constraints

**Depends on:** Phase 8

**Plans:** 0 plans (keep as TBD — actual plans created during /gsd:plan-phase 9)

Also add Phase 9 to the Progress table at the bottom of ROADMAP.md:
| 9. Discord Notifications & Leaderboard | 0/? | Not started | - |

Also update the Execution Order note to mention Phase 9 depends on Phase 8.

Do NOT change any other phase sections. Use the Edit tool to make targeted changes.
  </action>
  <verify>
    <automated>grep -c "DISC-01\|DISC-02\|DISC-03\|DISC-04\|LEAD-01\|LEAD-02\|LEAD-03" .planning/ROADMAP.md</automated>
  </verify>
  <done>Phase 09 in ROADMAP.md has a concrete goal, 7 requirement IDs (DISC-01..04, LEAD-01..03), 5 success criteria, and appears in the progress table</done>
</task>

<task type="auto">
  <name>Task 2: Create 09-CONTEXT.md with locked decisions on Discord integration approach</name>
  <files>.planning/phases/09-add-discord-trade-notifications-and-leaderboard-copy-strategy/09-CONTEXT.md</files>
  <action>
Create a CONTEXT.md in the phase 09 directory following the discuss-phase output format.
This captures the user's architectural decisions so plan-phase has clear constraints.

**Decisions (locked):**

D-01: Discord trade notifications use webhooks via native fetch POST from Workers.
  - Rationale: Webhooks are one-way fire-and-forget HTTP POSTs. No persistent connections,
    no WebSocket, no bot process needed. Works natively in Cloudflare Workers with zero
    external dependencies.
  - Implication: The notification service is a simple utility function that builds a JSON
    payload and calls fetch(webhookUrl, { method: "POST", body: ... }).

D-02: No Discord library needed for webhook notifications.
  - Rationale: Discord webhook API is a single POST endpoint accepting JSON with content
    and/or embeds fields. Using a library for this adds unnecessary dependency weight.
  - Implication: DISC-01 through DISC-04 use only native fetch.

D-03: If interactive Discord bot features are needed later (slash commands for leaderboard
queries, copy strategy management commands), use discordeno as the Discord library.
  - Rationale: discordeno is designed for serverless/edge runtimes, unlike discord.js which
    requires Node.js APIs. It can run in Deno, Bun, and Cloudflare Workers.
  - Implication: This is deferred — phase 09 scope covers webhooks only. Interactive bot
    features would be a future phase.

**Deferred Ideas:**
- Interactive Discord bot with slash commands (future phase, would use discordeno)
- Discord bot presence/status display
- Channel management or role-based notifications

**Claude's Discretion:**
- Exact emoji set for trade type indicators
- Whether to use Discord embeds vs plain text content for message formatting
- Retry logic for webhook delivery failures
- Message batching strategy if multiple trades execute in same tick

**Essential Features (from todo spec):**
- Trade type indicators: COPY BUY, COPY SELL, TAKE PROFIT, STOP LOSS
- Message fields: market name, outcome, price, shares, cost, fees, P&L, trader address, timestamp
- Portfolio summary footer: cash, equity, realized P&L, fees, net, position count, trade count
- Optional category tags like [sports], [crypto]

Write the file using the Write tool.
  </action>
  <verify>
    <automated>test -f .planning/phases/09-add-discord-trade-notifications-and-leaderboard-copy-strategy/09-CONTEXT.md && grep -c "D-01\|D-02\|D-03\|discordeno\|webhook" .planning/phases/09-add-discord-trade-notifications-and-leaderboard-copy-strategy/09-CONTEXT.md</automated>
  </verify>
  <done>09-CONTEXT.md exists with 3 locked decisions (D-01 webhook approach, D-02 no library for webhooks, D-03 discordeno for future interactive features), deferred ideas section, and essential feature list from the todo spec</done>
</task>

</tasks>

<verification>
- ROADMAP.md phase 09 section has goal, 7 requirement IDs, 5 success criteria
- 09-CONTEXT.md has 3 locked decisions capturing webhook and discordeno choices
- No source code files modified
- No other ROADMAP phases altered
</verification>

<success_criteria>
- Phase 09 in ROADMAP.md is fully specified (no "[To be planned]" or "TBD" for goal/requirements)
- 09-CONTEXT.md captures all three architectural decisions as locked
- Interactive Discord bot features are explicitly deferred
- Running /gsd:plan-phase 9 would have clear constraints to work from
</success_criteria>

<output>
After completion, create `.planning/quick/260322-jcc-update-phase-09-docs-to-use-discord-webh/260322-jcc-SUMMARY.md`
</output>
