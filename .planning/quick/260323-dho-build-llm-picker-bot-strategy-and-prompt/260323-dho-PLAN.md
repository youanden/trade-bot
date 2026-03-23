---
phase: quick
plan: 260323-dho
type: execute
wave: 1
depends_on: []
files_modified:
  - src/worker/bots/llm-picker/config.ts
  - src/worker/bots/llm-picker/strategy.ts
  - src/worker/bots/registry.ts
  - src/worker/api/routes/promptTest.ts
  - src/worker/index.ts
  - src/ui/pages/PromptTester.tsx
  - src/ui/App.tsx
  - src/ui/lib/api.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "llm-picker strategy is registered and can be selected when creating a bot"
    - "llm-picker strategy calls env.AI with configurable prompt template and market data"
    - "Prompt Tester page lets user select markets, edit prompts, and see LLM responses"
    - "POST /api/prompt-test endpoint accepts marketIds + prompt and returns LLM output"
  artifacts:
    - path: "src/worker/bots/llm-picker/strategy.ts"
      provides: "LLM picker strategy tick function"
      exports: ["llmPickerTick"]
    - path: "src/worker/bots/llm-picker/config.ts"
      provides: "Config interface with prompt template field"
      exports: ["LlmPickerConfig", "DEFAULT_LLM_PICKER_CONFIG"]
    - path: "src/worker/api/routes/promptTest.ts"
      provides: "POST /api/prompt-test endpoint"
    - path: "src/ui/pages/PromptTester.tsx"
      provides: "Prompt tester UI page"
      exports: ["PromptTester"]
  key_links:
    - from: "src/worker/bots/registry.ts"
      to: "src/worker/bots/llm-picker/strategy.ts"
      via: "strategies.set('llm-picker', llmPickerTick)"
      pattern: "strategies\\.set.*llm-picker"
    - from: "src/ui/App.tsx"
      to: "src/ui/pages/PromptTester.tsx"
      via: "Route path=/prompt-tester"
      pattern: "prompt-tester"
    - from: "src/worker/index.ts"
      to: "src/worker/api/routes/promptTest.ts"
      via: "app.route('/api/prompt-test', ...)"
      pattern: "prompt-test"
---

<objective>
Build an LLM picker bot strategy that uses a configurable prompt template to ask Cloudflare AI to pick a winner for prediction markets, plus a Prompt Tester UI page for experimenting with different prompts against real market data.

Purpose: Enable LLM-driven market picking with a user-editable prompt, and provide a sandbox UI to test prompts before deploying them on a live bot.
Output: New `llm-picker` strategy registered in bot registry, new `/api/prompt-test` endpoint, new `/prompt-tester` UI page.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/worker/bots/registry.ts
@src/worker/bots/llm-assessor/strategy.ts
@src/worker/bots/llm-assessor/config.ts
@src/worker/bots/base.ts
@src/worker/core/db/schema.ts
@src/worker/index.ts
@src/worker/api/routes/markets.ts
@src/ui/App.tsx
@src/ui/lib/api.ts
@env.d.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/worker/bots/base.ts:
```typescript
export interface BotConfig {
  botType: string;
  name: string;
  tickIntervalMs: number;
  dbBotId?: number;
  [key: string]: unknown;
}
```

From src/worker/bots/registry.ts:
```typescript
export type StrategyTickFn = (bot: BaseBotDO, env: Env) => Promise<void>;
export function registerStrategy(botType: string, tickFn: StrategyTickFn): void;
export function getStrategy(botType: string): StrategyTickFn | undefined;
```

From env.d.ts:
```typescript
interface Env {
  DB: D1Database;
  AI?: Ai;
  // ... other bindings
}
```

From src/worker/bots/llm-assessor/config.ts (reference pattern):
```typescript
export interface LlmAssessorConfig extends BotConfig {
  botType: "llm-assessor";
  platform: "polymarket" | "kalshi";
  aiModel: string;
  minEdge: number;
  maxPositionSize: number;
  categories?: string[];
}
```

From src/worker/core/db/schema.ts (markets table):
```typescript
// markets: id, platform, platformId, title, description, category, status, endDate, ...
// prices: id, marketId, yesPrice, noPrice, volume, timestamp, ...
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create llm-picker strategy with configurable prompt template and register it</name>
  <files>
    src/worker/bots/llm-picker/config.ts,
    src/worker/bots/llm-picker/strategy.ts,
    src/worker/bots/registry.ts
  </files>
  <action>
1. Create `src/worker/bots/llm-picker/config.ts`:
   - Define `LlmPickerConfig extends BotConfig` with fields:
     - `botType: "llm-picker"`
     - `platform: "polymarket" | "kalshi"` — which exchange to trade on
     - `aiModel: string` — Workers AI model ID (default `"@cf/meta/llama-3-8b-instruct"`)
     - `promptTemplate: string` — configurable prompt template with placeholders `{{title}}`, `{{description}}`, `{{yesPrice}}`, `{{noPrice}}`, `{{category}}`, `{{endDate}}`
     - `maxPositionSize: number` — max contracts per trade (default 100)
     - `marketIds?: string[]` — optional list of specific platform market IDs to evaluate; if empty, discover active markets
     - `maxMarkets?: number` — max markets to evaluate per tick (default 5)
   - Export `DEFAULT_LLM_PICKER_CONFIG` with sensible defaults including a default prompt template:
     ```
     You are a prediction market analyst. Given this market, decide whether to BUY YES or BUY NO.

     Market: {{title}}
     Description: {{description}}
     Category: {{category}}
     End Date: {{endDate}}
     Current YES Price: {{yesPrice}}%
     Current NO Price: {{noPrice}}%

     Respond with ONLY a JSON object: {"pick": "yes" | "no", "confidence": 0.0-1.0, "reasoning": "brief explanation"}
     ```
   - `tickIntervalMs: 300_000` (5 min, same as llm-assessor)

2. Create `src/worker/bots/llm-picker/strategy.ts`:
   - Export `llmPickerTick` as `StrategyTickFn`
   - Follow the llm-assessor pattern closely:
     - Cast `(bot as any).config as LlmPickerConfig`
     - Create DB, PortfolioRisk with `getLimitsForBot("llm-picker")`
     - Check `risk.isDailyLossBreached()` early return
     - Check `env.AI` exists, early return with error log if not
     - Create exchange client via `createExchangeClient(env, config.platform)`
     - Resolve markets: use `config.marketIds` if set, otherwise `client.getMarkets({ limit: config.maxMarkets ?? 5, status: "active" })`
     - For each market:
       a. Fetch price via `client.getPrice(market.platformId)`
       b. Build prompt by replacing `{{title}}`, `{{description}}`, `{{yesPrice}}` (formatted as percentage like `72.0`), `{{noPrice}}`, `{{category}}`, `{{endDate}}` placeholders in `config.promptTemplate`
       c. Call `env.AI.run(config.aiModel as any, { messages: [{ role: "system", content: "You are a prediction market analyst. Respond with ONLY valid JSON." }, { role: "user", content: interpolatedPrompt }] })`
       d. Parse response: extract JSON with `{"pick": "yes"|"no", "confidence": 0.XX, "reasoning": "..."}` — use regex similar to llm-assessor's `parseProbability` but for this schema. Create a `parsePickerResponse` function.
       e. If `pick` is valid and `confidence >= 0.5`: place order via `client.placeOrder({ marketId, side: "buy", outcome: pick, price: pick === "yes" ? price.yes : price.no, size: Math.min(config.maxPositionSize, riskCheck.suggestedSize ?? config.maxPositionSize) })`
       f. Record trade via `(bot as any).recordTrade(...)` with reason `llm-picker:pick=${pick}:conf=${confidence.toFixed(2)}`
       g. Wrap each market evaluation in try/catch, log errors
   - Use `Logger` with `{ strategy: "llm-picker" }`

3. Update `src/worker/bots/registry.ts`:
   - Add `import { llmPickerTick } from "./llm-picker/strategy";`
   - Add `strategies.set("llm-picker", llmPickerTick);`
  </action>
  <verify>
    TypeScript compiles: cd /Users/youanden/Work/trade-bot && npx tsc --noEmit --pretty 2>&1 | head -30
  </verify>
  <done>
    llm-picker strategy is registered in the bot registry, has a configurable prompt template in its config, calls env.AI with interpolated market data, parses pick/confidence JSON response, and places trades accordingly.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create prompt-test API endpoint and Prompt Tester UI page</name>
  <files>
    src/worker/api/routes/promptTest.ts,
    src/worker/index.ts,
    src/ui/pages/PromptTester.tsx,
    src/ui/App.tsx,
    src/ui/lib/api.ts
  </files>
  <action>
1. Create `src/worker/api/routes/promptTest.ts`:
   - Hono route module following the pattern in `markets.ts`
   - `POST /` handler:
     - Accepts JSON body: `{ marketIds: number[], prompt: string, aiModel?: string }`
     - `marketIds` are DB IDs (integer) from the `markets` table
     - Validates `env.AI` exists, returns 400 if not
     - Validates `marketIds` is non-empty array and `prompt` is non-empty string
     - For each marketId:
       a. Query `markets` table to get market data (title, description, category, endDate)
       b. Query latest price from `prices` table for that market
       c. Interpolate prompt template: replace `{{title}}`, `{{description}}`, `{{yesPrice}}` (percentage), `{{noPrice}}`, `{{category}}`, `{{endDate}}` — same logic as strategy
       d. Call `env.AI.run(aiModel ?? "@cf/meta/llama-3-8b-instruct", { messages: [{ role: "system", content: "You are a prediction market analyst. Respond with ONLY valid JSON." }, { role: "user", content: interpolatedPrompt }] })`
       e. Collect response text
     - Return JSON array: `[{ marketId, title, yesPrice, noPrice, prompt: interpolatedPrompt, response: responseText, parsed: { pick, confidence, reasoning } | null }]`
     - Use `aiModel` from body, defaulting to `"@cf/meta/llama-3-8b-instruct"`
   - Extract the prompt interpolation into a shared helper function `interpolatePrompt(template: string, vars: { title: string, description: string, yesPrice: number, noPrice: number, category: string, endDate: string }): string` — export it so the strategy can also use it (or duplicate if simpler; keep both consistent).

2. Wire API route in `src/worker/index.ts`:
   - Add `import promptTestRoutes from "./api/routes/promptTest";`
   - Add `app.route("/api/prompt-test", promptTestRoutes);` alongside existing routes

3. Add API method in `src/ui/lib/api.ts`:
   - Add `testPrompt: (data: { marketIds: number[]; prompt: string; aiModel?: string }) => request<any[]>("/prompt-test", { method: "POST", body: JSON.stringify(data) })`

4. Create `src/ui/pages/PromptTester.tsx`:
   - Export named function `PromptTester`
   - Layout: full-width page with Tailwind classes matching existing pages
   - Three sections stacked vertically:

   **Section A: Market Selector**
   - Fetch markets via `api.listMarkets()` using `useQuery`
   - Display as a scrollable list of checkboxes (max-h-64 overflow-y-auto border rounded)
   - Each row: checkbox + market title + platform badge + yes/no price
   - "Select All" / "Deselect All" buttons
   - Show count of selected markets

   **Section B: Prompt Editor**
   - Textarea (min-h-[200px], monospace font, full width) bound to state
   - Pre-populate with DEFAULT prompt template (same as the one in LlmPickerConfig defaults)
   - Show available placeholders as hint text below: `{{title}}, {{description}}, {{yesPrice}}, {{noPrice}}, {{category}}, {{endDate}}`
   - Optional: AI model text input (default "@cf/meta/llama-3-8b-instruct")
   - 3 preset prompt buttons above textarea that set different templates:
     a. "Default Picker" — the standard pick yes/no template
     b. "Probability Assessor" — asks for probability estimate (like llm-assessor)
     c. "Risk Analyst" — asks to evaluate risk factors and recommend position sizing
   - "Run" button (primary style, disabled when no markets selected or prompt empty)

   **Section C: Results**
   - Show a loading spinner when mutation is in flight (use `useMutation` from TanStack Query)
   - Display results as cards, one per market:
     - Market title, platform, prices
     - "Interpolated Prompt" in a collapsible `<details>` element
     - "Raw Response" in a pre/code block (whitespace-pre-wrap)
     - "Parsed" section showing pick, confidence, reasoning if parsed successfully, or "Parse failed" in red if null
   - Use `cn()` utility for conditional classes

5. Add route and nav in `src/ui/App.tsx`:
   - Import `PromptTester` from `./pages/PromptTester`
   - Add `<Route path="/prompt-tester" element={<PromptTester />} />` to Routes
   - Add `<NavItem to="/prompt-tester">Prompt Tester</NavItem>` to the nav bar
  </action>
  <verify>
    TypeScript compiles: cd /Users/youanden/Work/trade-bot && npx tsc --noEmit --pretty 2>&1 | head -30
  </verify>
  <done>
    POST /api/prompt-test endpoint accepts market IDs and a prompt, calls Cloudflare AI for each market, and returns structured results. The /prompt-tester UI page displays a market selector, editable prompt textarea with presets, a Run button, and formatted results with raw and parsed LLM output.
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes with no errors
- `llm-picker` appears in `GET /api/strategies` response
- New route `POST /api/prompt-test` is mounted and returns 400 when AI binding is missing
- `/prompt-tester` route renders in the React app with market list, prompt editor, and run button
</verification>

<success_criteria>
- llm-picker strategy is registered and selectable when creating a new bot
- Strategy uses configurable prompt template from bot config with market data interpolation
- Prompt Tester page loads markets, allows prompt editing with presets, runs prompts via API, and displays results
- All TypeScript compiles without errors
</success_criteria>

<output>
After completion, create `.planning/quick/260323-dho-build-llm-picker-bot-strategy-and-prompt/260323-dho-SUMMARY.md`
</output>
