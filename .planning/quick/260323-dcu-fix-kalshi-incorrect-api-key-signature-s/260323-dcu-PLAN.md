---
phase: quick
plan: 260323-dcu
type: execute
wave: 1
depends_on: []
files_modified:
  - src/worker/core/exchanges/kalshi/client.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Kalshi API signature includes /trade-api/v2 prefix in signed message"
    - "Kalshi API requests authenticate successfully (no INCORRECT_API_KEY_SIGNATURE)"
  artifacts:
    - path: "src/worker/core/exchanges/kalshi/client.ts"
      provides: "Fixed sign() method with full path prefix"
      contains: "new URL(this.baseUrl).pathname"
  key_links:
    - from: "sign()"
      to: "apiFetch()"
      via: "signature generation includes baseUrl pathname prefix"
      pattern: "new URL.*pathname"
---

<objective>
Fix Kalshi INCORRECT_API_KEY_SIGNATURE error by prepending the /trade-api/v2 path prefix to the signed message in the sign() method.

Purpose: Kalshi's API requires the full URL path including the /trade-api/v2 prefix when computing the request signature. Currently, only the relative path (e.g., /portfolio/orders) is signed, causing all authenticated requests to fail.

Output: Working Kalshi API authentication.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/worker/core/exchanges/kalshi/client.ts
@src/worker/core/exchanges/kalshi/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix sign() to include baseUrl pathname prefix in signed message</name>
  <files>src/worker/core/exchanges/kalshi/client.ts</files>
  <action>
In the `sign()` method (line ~222), change the message construction from:

```typescript
const message = timestampMs + method.toUpperCase() + pathNoQuery;
```

to:

```typescript
const basePathPrefix = new URL(this.baseUrl).pathname;
const message = timestampMs + method.toUpperCase() + basePathPrefix + pathNoQuery;
```

This extracts `/trade-api/v2` from `this.baseUrl` (e.g., `https://api.elections.kalshi.com/trade-api/v2`) dynamically using `new URL().pathname`, so it works for both prod and demo environments.

Do NOT hardcode `/trade-api/v2` — extract it from `this.baseUrl` so the fix stays correct if KALSHI_URLS ever changes.

The `path` parameter passed to `sign()` from `apiFetch()` is already a relative path like `/portfolio/orders`, so the full signed path becomes `/trade-api/v2/portfolio/orders` which matches the actual request URL `${this.baseUrl}${path}`.
  </action>
  <verify>
    <automated>cd /Users/youanden/Work/trade-bot && grep -n "new URL(this.baseUrl).pathname" src/worker/core/exchanges/kalshi/client.ts && grep -n "basePathPrefix + pathNoQuery" src/worker/core/exchanges/kalshi/client.ts</automated>
  </verify>
  <done>The sign() method constructs the signature message as `timestampMs + METHOD + /trade-api/v2 + /relative/path`, matching Kalshi's expected signature format.</done>
</task>

</tasks>

<verification>
- grep confirms `new URL(this.baseUrl).pathname` is used in sign()
- grep confirms the message string includes the base path prefix before pathNoQuery
- TypeScript compiles without errors: `npx tsc --noEmit --pretty 2>&1 | grep -c "error"` returns 0
</verification>

<success_criteria>
- sign() method prepends the baseUrl pathname (/trade-api/v2) to the path in the signature message
- No hardcoded path prefix strings
- TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/260323-dcu-fix-kalshi-incorrect-api-key-signature-s/260323-dcu-SUMMARY.md`
</output>
