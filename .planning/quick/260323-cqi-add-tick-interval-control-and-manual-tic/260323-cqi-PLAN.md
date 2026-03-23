---
phase: quick-260323-cqi
plan: 01
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
requirements: [TICK-INTERVAL, MANUAL-TICK, LIVE-CONFIG-UPDATE]
must_haves:
  truths:
    - "User can edit tickIntervalMs in the BotDetail config form and save it"
    - "User can click Trigger Tick to force a single immediate tick on a running bot"
    - "Saving config while bot is running pushes changes to the live DO without restart"
  artifacts:
    - path: "src/worker/bots/base.ts"
      provides: "forceTick RPC method and alarm reschedule in updateConfig"
      contains: "async forceTick"
    - path: "src/worker/api/routes/bots.ts"
      provides: "POST /:id/tick endpoint and DO forwarding in PATCH /:id/config"
      contains: "/:id/tick"
    - path: "src/ui/pages/BotDetail.tsx"
      provides: "tickIntervalMs form field and Trigger Tick button"
      contains: "tickIntervalMs"
  key_links:
    - from: "src/ui/pages/BotDetail.tsx"
      to: "/api/bots/:id/tick"
      via: "useForceTick hook"
      pattern: "forceTick"
    - from: "src/worker/api/routes/bots.ts"
      to: "src/worker/bots/base.ts"
      via: "stub.forceTick() and stub.updateConfig()"
      pattern: "stub.*forceTick|stub.*updateConfig"
---

<objective>
Add tick interval control and manual tick trigger to the BotDetail page.

Purpose: Allow users to adjust how frequently a bot ticks and manually trigger a tick for debugging, with live config updates pushed to the running Durable Object.
Output: Updated worker RPC, API routes, and UI with tickIntervalMs editing and a Trigger Tick button.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/worker/bots/base.ts
@src/worker/api/routes/bots.ts
@src/ui/lib/api.ts
@src/ui/hooks/useBots.ts
@src/ui/pages/BotDetail.tsx

<interfaces>
<!-- BaseBotDO RPC methods executor needs to extend -->
From src/worker/bots/base.ts:
```typescript
export interface BotConfig {
  botType: string;
  name: string;
  tickIntervalMs: number;
  dbBotId?: number;
  [key: string]: unknown;
}

// Existing RPC methods on BaseBotDO:
async start(config: BotConfig): Promise<void>;
async stop(): Promise<void>;
async getStatus(): Promise<BotStatus>;
async updateConfig(partial: Partial<BotConfig>): Promise<void>;
```

From src/ui/lib/api.ts:
```typescript
export const api = {
  startBot: (id: number) => request<{ ok: boolean }>(`/bots/${id}/start`, { method: "POST" }),
  stopBot: (id: number) => request<{ ok: boolean }>(`/bots/${id}/stop`, { method: "POST" }),
  updateBotConfig: (id: number, config: Record<string, unknown>) =>
    request<any>(`/bots/${id}/config`, { method: "PATCH", body: JSON.stringify(config) }),
};
```

From src/ui/hooks/useBots.ts:
```typescript
export function useUpdateBotConfig(id: number) { /* useMutation wrapping api.updateBotConfig */ }
export function useStartBot() { /* useMutation wrapping api.startBot */ }
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add forceTick RPC, alarm reschedule on updateConfig, and POST /tick API route</name>
  <files>src/worker/bots/base.ts, src/worker/api/routes/bots.ts</files>
  <action>
**In src/worker/bots/base.ts:**

1. Add a `forceTick()` public async RPC method to `BaseBotDO`. It should:
   - Guard: if `!this.config` throw `new Error("Bot not initialized")`
   - Call `await this.tick()` directly (same as alarm does, but without rescheduling)
   - Increment `this.tickCount`, set `this.lastTick = new Date().toISOString()`, clear `this.lastError`
   - Wrap in try/catch mirroring the alarm error handling (set `this.lastError` on failure)
   - Do NOT reschedule the alarm — the existing alarm loop continues independently
   - Add audit call: `await this.audit("force-tick")`

2. Update the existing `updateConfig()` method to reschedule the alarm when `tickIntervalMs` changes and the bot is running:
   - After merging config and persisting to storage (existing code), add:
   - If `this.running && partial.tickIntervalMs !== undefined`, delete current alarm and schedule a new one: `await this.ctx.storage.deleteAlarm(); await this.ctx.storage.setAlarm(Date.now() + this.config.tickIntervalMs);`

**In src/worker/api/routes/bots.ts:**

3. Add `POST /:id/tick` route (place it after the `/:id/stop` route and before `/:id/status`):
   - Same bot lookup + DO stub pattern as start/stop (fetch bot from DB, check durableObjectId exists, get stub)
   - Call `await (stub as any).forceTick()`
   - Return `c.json({ ok: true })`

4. Update the existing `PATCH /:id/config` route to also forward config to the running DO:
   - After the existing DB update (line ~148-154), add: if the bot has a `durableObjectId` and `bot.status === "running"`, get the DO stub and call `await (stub as any).updateConfig(body)` so the live DO picks up the change
   - Keep existing DB merge logic unchanged
  </action>
  <verify>
    <automated>cd /Users/youanden/Work/trade-bot && npx tsc --noEmit --pretty 2>&1 | head -30</automated>
  </verify>
  <done>forceTick RPC exists on BaseBotDO, updateConfig reschedules alarm when tickIntervalMs changes, POST /bots/:id/tick endpoint returns 200, PATCH /bots/:id/config forwards to running DO</done>
</task>

<task type="auto">
  <name>Task 2: Add tickIntervalMs form field, Trigger Tick button, and useForceTick hook to UI</name>
  <files>src/ui/lib/api.ts, src/ui/hooks/useBots.ts, src/ui/pages/BotDetail.tsx</files>
  <action>
**In src/ui/lib/api.ts:**

1. Add `forceTick` method to the `api` object:
   ```
   forceTick: (id: number) =>
     request<{ ok: boolean }>(`/bots/${id}/tick`, { method: "POST" }),
   ```

**In src/ui/hooks/useBots.ts:**

2. Add `useForceTick` hook:
   ```
   export function useForceTick(id: number) {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: () => api.forceTick(id),
       onSuccess: () => qc.invalidateQueries({ queryKey: ["bots", id, "status"] }),
     });
   }
   ```

**In src/ui/pages/BotDetail.tsx:**

3. Add `tickIntervalMs` to `ConfigFormState` interface:
   - Add field: `tickIntervalMs: number;`

4. Update `configToFormState` to include tickIntervalMs:
   - Add: `tickIntervalMs: config?.tickIntervalMs ?? 60000,`

5. Update `isDirty` useMemo to also compare `formState.tickIntervalMs !== orig.tickIntervalMs`.

6. Add tickIntervalMs input field in the config form grid (after the Platform select, before Spread Width):
   ```jsx
   <label className="block space-y-1">
     <span className="text-sm font-medium">Tick Interval (ms)</span>
     <input
       type="number"
       step="1000"
       min="1000"
       value={formState.tickIntervalMs}
       onChange={(e) => handleFieldChange("tickIntervalMs", Number(e.target.value))}
       className={inputClass}
     />
   </label>
   ```

7. Import `useForceTick` from hooks and instantiate it: `const forceTick = useForceTick(botId);`

8. Add a "Trigger Tick" button in the header button group, next to Start/Stop. Only show when bot status is "running":
   ```jsx
   {bot.status === "running" && (
     <button
       className="px-4 py-2 text-sm rounded-md border hover:bg-muted"
       onClick={() => forceTick.mutate()}
       disabled={forceTick.isPending}
     >
       {forceTick.isPending ? "Ticking..." : "Trigger Tick"}
     </button>
   )}
   ```
   Place this button before the Start/Stop button in the `flex gap-2` div.
  </action>
  <verify>
    <automated>cd /Users/youanden/Work/trade-bot && npx tsc --noEmit --pretty 2>&1 | head -30</automated>
  </verify>
  <done>BotDetail shows editable tickIntervalMs field, Trigger Tick button appears when bot is running, saving config with changed tickIntervalMs updates the live DO alarm schedule</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. Manual: Start vite dev + wrangler dev, navigate to a bot detail page, verify tickIntervalMs field appears with default 60000
3. Manual: Change tickIntervalMs, save, confirm the running bot picks up the new interval
4. Manual: Click "Trigger Tick" on a running bot, confirm tick count increments in the status card
</verification>

<success_criteria>
- tickIntervalMs is editable in BotDetail config form and persists on save
- Trigger Tick button visible only when bot is running, triggers a single immediate tick
- Saving config while bot is running forwards changes to the live DO (alarm rescheduled for interval changes)
- TypeScript compiles without errors
</success_criteria>

<output>
After completion, create `.planning/quick/260323-cqi-add-tick-interval-control-and-manual-tic/260323-cqi-SUMMARY.md`
</output>
