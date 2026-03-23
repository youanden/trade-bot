---
phase: quick
plan: 260323-cut
type: execute
wave: 1
depends_on: []
files_modified:
  - src/worker/bots/base.ts
  - src/worker/api/routes/bots.ts
  - src/ui/lib/api.ts
  - src/ui/hooks/useBots.ts
  - src/ui/pages/BotDetail.tsx
autonomous: true
requirements: []
must_haves:
  truths:
    - "BotDetail page shows recent audit log entries for the bot"
    - "Tick errors and successes are recorded in the audit_log table"
    - "Error state from bot_instances.errorMessage is visible on the BotDetail page"
    - "Logs auto-refresh while viewing a running bot"
  artifacts:
    - path: "src/worker/bots/base.ts"
      provides: "Tick-level audit logging (success + error entries)"
    - path: "src/worker/api/routes/bots.ts"
      provides: "GET /api/bots/:id/logs endpoint"
    - path: "src/ui/pages/BotDetail.tsx"
      provides: "Recent Logs panel and enhanced error banner"
  key_links:
    - from: "src/ui/pages/BotDetail.tsx"
      to: "/api/bots/:id/logs"
      via: "useBotLogs hook with polling"
      pattern: "refetchInterval.*5000"
    - from: "src/worker/bots/base.ts"
      to: "audit_log table"
      via: "this.audit() calls in alarm() catch/success"
      pattern: "audit.*tick"
---

<objective>
Add a Recent Logs panel to the BotDetail page and enhance error visibility.

Purpose: Currently, tick errors (like Kalshi 401 auth errors) are logged to console but not surfaced in the UI. The audit_log table exists but only records lifecycle events (start/stop/config-update). This plan adds tick-level logging to the DB, exposes it via API, and renders it in a scrollable log panel on BotDetail. It also surfaces the persistent errorMessage from bot_instances in a visible error banner.

Output: Logs panel on BotDetail with auto-refresh, tick error/success audit entries in DB, error banner for persistent bot errors.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/worker/bots/base.ts (BaseBotDO with audit() method, alarm() loop, BotStatus interface)
@src/worker/api/routes/bots.ts (Bot CRUD + status routes)
@src/worker/core/db/schema.ts (audit_log table: id, bot_instance_id, action, details JSON, created_at)
@src/ui/pages/BotDetail.tsx (Current bot detail page with status card, config form, trades table)
@src/ui/lib/api.ts (API client with request helper)
@src/ui/hooks/useBots.ts (React Query hooks for bots)

<interfaces>
From src/worker/core/db/schema.ts:
```typescript
export const auditLog = sqliteTable("audit_log", {
  id: integer().primaryKey({ autoIncrement: true }),
  botInstanceId: integer("bot_instance_id").references(() => botInstances.id),
  action: text().notNull(),
  details: text({ mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// bot_instances has errorMessage column:
export const botInstances = sqliteTable("bot_instances", {
  // ...
  errorMessage: text("error_message"),
  // ...
});
```

From src/worker/bots/base.ts:
```typescript
export interface BotStatus {
  id: string;
  botType: string;
  name: string;
  running: boolean;
  lastTick: string | null;
  tickCount: number;
  error: string | null;
}

// audit() is private, inserts into auditLog table
// alarm() catches tick errors and sets lastError + writes errorMessage to DB
// alarm() success path clears lastError but does NOT audit
```

From src/ui/lib/api.ts:
```typescript
export const api = {
  getBotStatus: (id: number) => request<any>(`/bots/${id}/status`),
  // ... other methods
};
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add tick audit logging and GET /api/bots/:id/logs endpoint</name>
  <files>src/worker/bots/base.ts, src/worker/api/routes/bots.ts</files>
  <action>
**In src/worker/bots/base.ts:**

1. In the `alarm()` method, add audit logging for tick outcomes:
   - In the `try` block after `this.lastError = null;` (line 70), add:
     `await this.audit("tick:success", { tickCount: this.tickCount });`
   - In the `catch` block after the errorMessage DB update (line 96), add:
     `await this.audit("tick:error", { error: msg, tickCount: this.tickCount });`

2. In the `forceTick()` method, enhance the audit call:
   - In the `try` block after `this.lastError = null;` (line 169), add:
     `await this.audit("force-tick:success", { tickCount: this.tickCount });`
   - In the `catch` block after `this.log.error(...)` (line 173), add:
     `await this.audit("force-tick:error", { error: msg, tickCount: this.tickCount });`
   - Remove the existing `await this.audit("force-tick");` at line 176 (it was unconditional and lacked detail).

**In src/worker/api/routes/bots.ts:**

1. Add import for `auditLog` from schema: `import { botInstances, auditLog } from "../../core/db/schema";`
2. Add import for `desc` from drizzle-orm: update the existing import to `import { eq, desc } from "drizzle-orm";`

3. Add a new route BEFORE the delete route:
```typescript
/** Get recent logs for a bot */
app.get("/:id/logs", async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param("id"));
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const logs = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.botInstanceId, id))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return c.json(logs);
});
```

This returns the most recent audit log entries for a specific bot, ordered newest first, with a configurable limit (default 50, max 200).
  </action>
  <verify>Run `npx wrangler dev --test-scheduled` briefly to confirm no TypeScript errors. Alternatively: `npx tsc --noEmit --skipLibCheck 2>&1 | head -20` to check for compilation errors in the modified files.</verify>
  <done>audit_log table receives tick:success and tick:error entries on every alarm cycle. GET /api/bots/:id/logs returns recent audit entries for a bot.</done>
</task>

<task type="auto">
  <name>Task 2: Add logs panel and error banner to BotDetail page</name>
  <files>src/ui/lib/api.ts, src/ui/hooks/useBots.ts, src/ui/pages/BotDetail.tsx</files>
  <action>
**In src/ui/lib/api.ts:**

Add to the `api` object:
```typescript
getBotLogs: (id: number, limit?: number) =>
  request<any[]>(`/bots/${id}/logs${limit ? `?limit=${limit}` : ""}`),
```

**In src/ui/hooks/useBots.ts:**

Add a new hook:
```typescript
export function useBotLogs(id: number) {
  return useQuery({
    queryKey: ["bots", id, "logs"],
    queryFn: () => api.getBotLogs(id, 50),
    refetchInterval: 5000,
  });
}
```

**In src/ui/pages/BotDetail.tsx:**

1. Import `useBotLogs` from `../hooks/useBots`.

2. Add an error banner below the header (between the header div and the grid). Show this when `bot.error_message` (from bot_instances table, snake_case because Drizzle returns DB column names) is present:
```tsx
{bot.error_message && (
  <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-4">
    <p className="text-sm font-medium text-red-800 dark:text-red-400">Persistent Error</p>
    <p className="text-sm text-red-700 dark:text-red-300 mt-1 font-mono break-all">
      {bot.error_message}
    </p>
  </div>
)}
```

3. Add a Recent Logs panel AFTER the Recent Trades section. Use `useBotLogs(botId)` for data. Render a scrollable list of log entries:

```tsx
{/* Recent Logs */}
<div className="rounded-lg border bg-card p-4 space-y-3">
  <h2 className="font-semibold">Recent Logs</h2>
  {logs?.length ? (
    <div className="max-h-80 overflow-y-auto space-y-1">
      {logs.map((log: any) => (
        <div
          key={log.id}
          className={cn(
            "flex items-start gap-3 py-1.5 px-2 rounded text-xs font-mono",
            log.action.includes("error")
              ? "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400"
              : "text-muted-foreground"
          )}
        >
          <span className="shrink-0 text-muted-foreground">
            {new Date(log.created_at).toLocaleTimeString()}
          </span>
          <span className={cn(
            "shrink-0 w-28",
            log.action.includes("error") && "text-red-600 dark:text-red-400 font-semibold"
          )}>
            {log.action}
          </span>
          <span className="truncate" title={JSON.stringify(log.details)}>
            {log.details && Object.keys(log.details).length > 0
              ? Object.entries(log.details)
                  .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
                  .join(" ")
              : ""}
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div className="text-sm text-muted-foreground">No logs yet.</div>
  )}
</div>
```

4. Wire the hook at the top of the component (after existing hooks):
```typescript
const { data: logs } = useBotLogs(botId);
```

Key styling notes:
- Error entries (action contains "error") get a red-tinted background
- Scrollable container with max-h-80 (320px) so it does not dominate the page
- Monospace font for log readability
- Timestamps show time only (not date) since these are recent logs
- Details are flattened to key=value pairs for quick scanning
  </action>
  <verify>Open the BotDetail page for a running bot at http://localhost:5173/bots/{id}. Trigger a tick and verify the logs panel shows new entries within 5 seconds. If the bot has auth errors, verify the error banner and red-highlighted log entries appear.</verify>
  <done>BotDetail page shows a scrollable Recent Logs panel with auto-refresh. Error log entries are visually distinct (red). Persistent bot errors from the DB show in a banner at the top. The logs endpoint returns audit_log entries filtered by bot ID.</done>
</task>

</tasks>

<verification>
1. Start a bot via the UI and trigger a tick -- audit_log table should have a tick:success or tick:error entry
2. Visit BotDetail page -- Recent Logs panel should appear and auto-refresh
3. If a bot has a tick error (e.g., Kalshi 401), the error banner should appear and the log entry should be red-highlighted
4. Logs endpoint: `curl http://localhost:8787/api/bots/{id}/logs` returns JSON array of recent logs
</verification>

<success_criteria>
- GET /api/bots/:id/logs returns audit log entries for the bot
- Tick success and error events are written to audit_log on every alarm cycle
- BotDetail page has a scrollable Recent Logs panel with 5s polling
- Error log entries are visually distinct from info entries
- Persistent bot errors (from bot_instances.errorMessage) show in a banner
</success_criteria>

<output>
After completion, create `.planning/quick/260323-cut-add-recent-logs-panel-to-botdetail-page-/260323-cut-SUMMARY.md`
</output>
