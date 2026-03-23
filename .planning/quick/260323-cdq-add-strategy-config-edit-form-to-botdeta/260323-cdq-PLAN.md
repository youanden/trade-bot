---
phase: quick
plan: 260323-cdq
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/pages/BotDetail.tsx
autonomous: true
requirements: [quick-task]
must_haves:
  truths:
    - "User sees a Configuration form with labeled inputs for all market-maker fields"
    - "User can edit platform, spreadWidth, orderSize, maxInventory, levels, maxMarkets, minVolume"
    - "User can add/remove marketIds via chip UI within the same form"
    - "User can save all config changes with a single Save button"
    - "Header, Live Status, and Recent Trades sections remain unchanged"
  artifacts:
    - path: "src/ui/pages/BotDetail.tsx"
      provides: "Strategy config edit form replacing read-only JSON and separate Market IDs section"
  key_links:
    - from: "src/ui/pages/BotDetail.tsx"
      to: "useUpdateBotConfig"
      via: "updateConfig.mutate() with full merged config object"
      pattern: "updateConfig\\.mutate"
---

<objective>
Replace the read-only JSON config card and separate Market IDs section in BotDetail.tsx with a single "Configuration" form exposing all market-maker strategy fields as labeled inputs, with a Save button that calls updateConfig.mutate() with the full merged config.

Purpose: Let users edit strategy parameters directly instead of reading raw JSON.
Output: Updated BotDetail.tsx with inline config form.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/pages/BotDetail.tsx
@src/ui/hooks/useBots.ts
@src/worker/bots/market-maker/config.ts

<interfaces>
From src/ui/hooks/useBots.ts:
```typescript
export function useUpdateBotConfig(id: number) {
  // mutationFn: (config: Record<string, unknown>) => api.updateBotConfig(id, config)
  // onSuccess: invalidates ["bots", id]
}
```

From src/worker/bots/market-maker/config.ts:
```typescript
export interface MarketMakerConfig extends BotConfig {
  botType: "market-maker";
  platform: "polymarket" | "kalshi";
  marketIds?: string[];
  spreadWidth: number;
  orderSize: number;
  maxInventory: number;
  levels: number;
  maxMarkets?: number;
  minVolume?: number;
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace config card and Market IDs section with editable Configuration form</name>
  <files>src/ui/pages/BotDetail.tsx</files>
  <action>
Rewrite BotDetail.tsx to replace the two sections (the read-only "Configuration" JSON card at lines 109-116 AND the "Market IDs" section at lines 118-167) with a single "Configuration" card containing an editable form. Keep header (lines 51-78), Live Status card (lines 82-107), and Recent Trades (lines 169-212) completely unchanged.

Form implementation:

1. Add form state using useState, initialized from bot.config (cast as any). Create a local state object with these fields and their defaults from bot.config:
   - platform: string (bot.config.platform ?? "polymarket")
   - spreadWidth: number (bot.config.spreadWidth ?? 0.04)
   - orderSize: number (bot.config.orderSize ?? 50)
   - maxInventory: number (bot.config.maxInventory ?? 500)
   - levels: number (bot.config.levels ?? 3)
   - maxMarkets: number (bot.config.maxMarkets ?? 5)
   - minVolume: number (bot.config.minVolume ?? 0)

2. Add a dirty-tracking flag: compare form state to bot.config values to enable/disable Save button. Use a simple useMemo or inline comparison.

3. Build the form layout inside the config card (replaces the JSON pre block). Use a grid layout (md:grid-cols-2 gap-4):
   - platform: a <select> with options "polymarket" and "kalshi". Label: "Platform".
   - spreadWidth: <input type="number" step="0.01">. Label: "Spread Width".
   - orderSize: <input type="number" step="1">. Label: "Order Size".
   - maxInventory: <input type="number" step="1">. Label: "Max Inventory".
   - levels: <input type="number" step="1" min="1">. Label: "Levels".
   - maxMarkets: <input type="number" step="1" min="1">. Label: "Max Markets".
   - minVolume: <input type="number" step="1" min="0">. Label: "Min Volume".

   Each field wrapped in a <label> with className "block space-y-1" containing a <span> for the label text (text-sm font-medium) and the input (w-full px-3 py-1.5 text-sm rounded-md border bg-background).

4. Below the grid, add the existing Market IDs chip UI (the add/remove chip UI from the current separate section). Keep the exact same chip rendering and add-input behavior but embed it inside this form card. Label it "Market IDs" with same font-medium styling.

5. At the bottom of the card, add a Save button row:
   - Save button: calls updateConfig.mutate() with the full merged config: { ...bot.config, ...formState, marketIds }
   - Disable Save when: updateConfig.isPending OR form is not dirty (no changes from bot.config)
   - Show error text below if updateConfig.isError: "Failed to update config."
   - Style: bg-primary text-primary-foreground px-4 py-2 text-sm rounded-md, right-aligned

6. The handleAddMarketId and handleRemoveMarketId functions should now update LOCAL state only (a local marketIds useState), NOT call updateConfig.mutate() directly. The single Save button submits everything together.

7. When bot.config changes (from server refetch), reset form state to match. Use a useEffect keyed on bot.config to reinitialize.

Keep the existing Row helper component unchanged. Keep all existing imports, add no new dependencies.
  </action>
  <verify>
    <automated>cd /Users/youanden/Work/trade-bot && npx tsc --noEmit src/ui/pages/BotDetail.tsx 2>&1 | head -20</automated>
  </verify>
  <done>
    - BotDetail.tsx renders a single Configuration card with labeled form inputs for platform (select), spreadWidth, orderSize, maxInventory, levels, maxMarkets, minVolume (number inputs), plus the marketIds chip add/remove UI
    - Save button calls updateConfig.mutate() with full merged config including all fields and marketIds
    - Save button disabled when no changes detected or mutation pending
    - Header, Live Status, and Recent Trades sections unchanged
    - No new dependencies added
    - TypeScript compiles without errors
  </done>
</task>

</tasks>

<verification>
- TypeScript compilation passes with no errors
- Visual check: form renders labeled inputs in grid layout, chip UI for market IDs, single Save button
</verification>

<success_criteria>
- Read-only JSON config card replaced with editable form inputs
- Separate Market IDs section merged into the Configuration form
- Single Save button submits all config changes at once
- All other page sections (header, live status, recent trades) unchanged
</success_criteria>

<output>
After completion, create `.planning/quick/260323-cdq-add-strategy-config-edit-form-to-botdeta/260323-cdq-SUMMARY.md`
</output>
