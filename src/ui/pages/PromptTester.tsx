import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

const DEFAULT_PICKER_PROMPT = `You are a prediction market analyst. Given this market, decide whether to BUY YES or BUY NO.

Market: {{title}}
Description: {{description}}
Category: {{category}}
End Date: {{endDate}}
Current YES Price: {{yesPrice}}%
Current NO Price: {{noPrice}}%

Respond with ONLY a JSON object: {"pick": "yes" | "no", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

const PROBABILITY_ASSESSOR_PROMPT = `Assess the probability of this prediction market resolving YES.

Market: {{title}}
{{description}}
Category: {{category}}
End Date: {{endDate}}
Current Market Price: {{yesPrice}}%

Based on your knowledge, what is the true probability this resolves YES?
Respond with JSON: {"pick": "yes" | "no", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

const RISK_ANALYST_PROMPT = `Analyze the risk profile of this prediction market and recommend a position.

Market: {{title}}
Description: {{description}}
Category: {{category}}
End Date: {{endDate}}
Current YES Price: {{yesPrice}}%
Current NO Price: {{noPrice}}%

Evaluate:
1. Information uncertainty
2. Time-to-resolution risk
3. Market efficiency signals
4. Whether the price reflects fair value

Respond with JSON: {"pick": "yes" | "no", "confidence": 0.0-1.0, "reasoning": "brief explanation with risk assessment"}`;

const PRESETS = [
  { label: "Default Picker", template: DEFAULT_PICKER_PROMPT },
  { label: "Probability Assessor", template: PROBABILITY_ASSESSOR_PROMPT },
  { label: "Risk Analyst", template: RISK_ANALYST_PROMPT },
];

const PLACEHOLDERS = "{{title}}, {{description}}, {{yesPrice}}, {{noPrice}}, {{category}}, {{endDate}}";

const CF_MODELS: { label: string; value: string; group: string }[] = [
  // Fast / small
  { group: "Fast", label: "Llama 3.1 8B Instruct (fast)", value: "@cf/meta/llama-3.1-8b-instruct-fast" },
  { group: "Fast", label: "Llama 3.1 8B Instruct", value: "@cf/meta/llama-3.1-8b-instruct" },
  { group: "Fast", label: "Llama 3.2 3B Instruct", value: "@cf/meta/llama-3.2-3b-instruct" },
  { group: "Fast", label: "Llama 3.2 1B Instruct", value: "@cf/meta/llama-3.2-1b-instruct" },
  // Capable
  { group: "Capable", label: "Llama 3.3 70B (fp8-fast)", value: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  { group: "Capable", label: "Llama 3.1 70B Instruct", value: "@cf/meta/llama-3.1-70b-instruct" },
  { group: "Capable", label: "Llama 4 Scout 17B", value: "@cf/meta/llama-4-scout-17b-16e-instruct" },
  { group: "Capable", label: "Mistral Small 3.1 24B", value: "@cf/mistral/mistral-small-3.1-24b-instruct" },
  { group: "Capable", label: "Gemma 3 12B", value: "@cf/google/gemma-3-12b-it" },
  { group: "Capable", label: "GPT-OSS 20B (OpenAI)", value: "@cf/openai/gpt-oss-20b" },
  { group: "Capable", label: "GPT-OSS 120B (OpenAI)", value: "@cf/openai/gpt-oss-120b" },
  { group: "Capable", label: "Kimi K2.5 (Moonshot AI)", value: "@cf/moonshotai/kimi-k2.5" },
  // Reasoning
  { group: "Reasoning", label: "DeepSeek R1 Distill Qwen 32B", value: "@cf/deepseek/deepseek-r1-distill-qwen-32b" },
  { group: "Reasoning", label: "QwQ 32B (Qwen)", value: "@cf/qwen/qwq-32b" },
  { group: "Reasoning", label: "Qwen 3 30B A3B (fp8)", value: "@cf/qwen/qwen3-30b-a3b-fp8" },
];

const CUSTOM_VALUE = "__custom__";

export function PromptTester() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [prompt, setPrompt] = useState(DEFAULT_PICKER_PROMPT);
  const [aiModel, setAiModel] = useState("@cf/meta/llama-3.1-8b-instruct");
  const [customModel, setCustomModel] = useState("");

  const isCustom = aiModel === CUSTOM_VALUE;
  const resolvedModel = isCustom ? customModel.trim() : aiModel;

  const { data: markets = [], isLoading: marketsLoading } = useQuery({
    queryKey: ["markets"],
    queryFn: () => api.listMarkets(100),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.testPrompt({
        marketIds: Array.from(selectedIds),
        prompt,
        aiModel: resolvedModel || undefined,
      }),
  });

  function toggleMarket(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(markets.map((m: any) => m.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  const canRun = selectedIds.size > 0 && prompt.trim().length > 0 && resolvedModel.length > 0 && !mutation.isPending;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Prompt Tester</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Test prompts against real market data before deploying a live llm-picker bot.
        </p>
      </div>

      {/* Section A: Market Selector */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Markets</h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <button
              onClick={selectAll}
              className="text-primary hover:underline"
            >
              Select All
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              onClick={deselectAll}
              className="text-primary hover:underline"
            >
              Deselect All
            </button>
          </div>
        </div>

        {marketsLoading ? (
          <p className="text-sm text-muted-foreground">Loading markets...</p>
        ) : markets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No markets found. Use the Markets page to seed or sync market data.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
            {markets.map((market: any) => (
              <label
                key={market.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={selectedIds.has(market.id)}
                  onChange={() => toggleMarket(market.id)}
                />
                <span className="flex-1 text-sm truncate">{market.title}</span>
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded font-mono shrink-0",
                    market.platform === "polymarket"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-purple-100 text-purple-700"
                  )}
                >
                  {market.platform}
                </span>
                {market.yesPrice != null && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    Y:{(market.yesPrice * 100).toFixed(0)}%{" "}
                    N:{((1 - market.yesPrice) * 100).toFixed(0)}%
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Section B: Prompt Editor */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Prompt Editor</h2>

        {/* Preset buttons */}
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setPrompt(preset.template)}
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full min-h-[200px] font-mono text-sm rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          placeholder="Enter your prompt template..."
        />

        <p className="text-xs text-muted-foreground">
          Available placeholders: <code>{PLACEHOLDERS}</code>
        </p>

        <div className="flex items-start gap-3 flex-wrap">
          <label className="text-sm text-muted-foreground shrink-0 pt-1.5">
            AI Model:
          </label>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="text-sm rounded-md border bg-background px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring w-full"
            >
              {["Fast", "Capable", "Reasoning"].map((group) => (
                <optgroup key={group} label={group}>
                  {CF_MODELS.filter((m) => m.group === group).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Other">
                <option value={CUSTOM_VALUE}>Custom model ID…</option>
              </optgroup>
            </select>
            {isCustom && (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="@cf/author/model-name"
                className="text-sm rounded-md border bg-background px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring font-mono w-full"
              />
            )}
            {!isCustom && (
              <p className="text-xs text-muted-foreground font-mono">{aiModel}</p>
            )}
          </div>
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={!canRun}
          className={cn(
            "px-4 py-2 rounded-md text-sm font-medium transition-colors",
            canRun
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {mutation.isPending ? "Running..." : "Run"}
        </button>
      </section>

      {/* Section C: Results */}
      {(mutation.isPending || mutation.data || mutation.error) && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Results</h2>

          {mutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg
                className="animate-spin h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Calling AI for {selectedIds.size} market(s)...
            </div>
          )}

          {mutation.error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "An error occurred"}
            </div>
          )}

          {mutation.data && mutation.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No results returned. Markets may not exist in the database.
            </p>
          )}

          {mutation.data?.map((result: any) => (
            <div
              key={result.marketId}
              className="rounded-md border p-4 space-y-3"
            >
              {/* Market header */}
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-sm">{result.title}</h3>
                {result.yesPrice != null && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    Y:{(result.yesPrice * 100).toFixed(0)}%{" "}
                    N:{((1 - result.yesPrice) * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              {/* Parsed result */}
              <div>
                {result.parsed ? (
                  <div className="flex items-center gap-3 flex-wrap text-sm">
                    <span
                      className={cn(
                        "font-bold px-2 py-0.5 rounded",
                        result.parsed.pick === "yes"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      )}
                    >
                      {result.parsed.pick.toUpperCase()}
                    </span>
                    <span className="text-muted-foreground">
                      Confidence:{" "}
                      <strong>{(result.parsed.confidence * 100).toFixed(0)}%</strong>
                    </span>
                    <span className="text-muted-foreground">
                      {result.parsed.reasoning}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-destructive">
                    Parse failed — could not extract pick/confidence/reasoning
                  </span>
                )}
              </div>

              {/* Interpolated Prompt (collapsible) */}
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                  Interpolated Prompt
                </summary>
                <pre className="mt-2 text-xs bg-muted rounded p-3 whitespace-pre-wrap overflow-x-auto">
                  {result.prompt}
                </pre>
              </details>

              {/* Raw Response */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Raw Response</p>
                <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap overflow-x-auto">
                  {result.response || "(empty)"}
                </pre>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
