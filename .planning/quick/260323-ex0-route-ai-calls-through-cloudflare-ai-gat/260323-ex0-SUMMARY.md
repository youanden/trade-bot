# Quick Task 260323-ex0: Route AI calls through Cloudflare AI Gateway

**Completed:** 2026-03-23
**Status:** Done

## Changes Made

### Task 1: Install packages + add env binding
- Installed `ai` (Vercel AI SDK) and `ai-gateway-provider` via bun
- Added `CF_AIG_TOKEN?: string` to `env.d.ts`

### Task 2: Update AI call sites to use AI Gateway
- `src/worker/api/routes/promptTest.ts` — replaced `c.env.AI.run()` with `generateText` via `createAiGateway` + `createUnified`; updated guard from AI binding check to `CF_AIG_TOKEN` check; updated `DEFAULT_AI_MODEL` to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `src/worker/bots/llm-picker/strategy.ts` — replaced `env.AI!.run()` with `generateText` via AI Gateway; replaced `env.AI` guard with `env.CF_AIG_TOKEN` guard; added imports
- `src/worker/bots/llm-picker/config.ts` — updated default `aiModel` from `@cf/meta/llama-3.1-8b-instruct` to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

## Model format
All calls now use `workers-ai/<cf-model-id>` format via the unified provider routed through AI Gateway at `default` gateway on account `2883160c80d41a3c439a131bf0378c6d`.
