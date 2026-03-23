import { Hono } from "hono";
import { createDb } from "../../core/db/client";
import { markets, prices } from "../../core/db/schema";
import { eq, desc } from "drizzle-orm";
import { interpolatePrompt, parsePickerResponse } from "../../bots/llm-picker/strategy";

const DEFAULT_AI_MODEL = "@cf/meta/llama-3-8b-instruct";

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/prompt-test
 *
 * Accepts: { marketIds: number[], prompt: string, aiModel?: string }
 * Returns: Array of per-market results with interpolated prompt, raw response, and parsed output.
 */
app.post("/", async (c) => {
  if (!c.env.AI) {
    return c.json({ error: "AI binding not configured" }, 400);
  }

  let body: { marketIds?: unknown; prompt?: unknown; aiModel?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { marketIds, prompt, aiModel } = body;

  if (!Array.isArray(marketIds) || marketIds.length === 0) {
    return c.json({ error: "marketIds must be a non-empty array" }, 400);
  }

  if (typeof prompt !== "string" || prompt.trim() === "") {
    return c.json({ error: "prompt must be a non-empty string" }, 400);
  }

  const model =
    typeof aiModel === "string" && aiModel.trim() !== ""
      ? aiModel.trim()
      : DEFAULT_AI_MODEL;

  const db = createDb(c.env.DB);
  const results: Array<{
    marketId: number;
    title: string;
    yesPrice: number | null;
    noPrice: number | null;
    prompt: string;
    response: string;
    parsed: { pick: string; confidence: number; reasoning: string } | null;
  }> = [];

  for (const rawId of marketIds) {
    const marketId = Number(rawId);
    if (isNaN(marketId)) continue;

    // 1. Fetch market data
    const [market] = await db
      .select()
      .from(markets)
      .where(eq(markets.id, marketId));

    if (!market) continue;

    // 2. Fetch latest price
    const priceRows = await db
      .select()
      .from(prices)
      .where(eq(prices.marketId, marketId))
      .orderBy(desc(prices.timestamp))
      .limit(1);

    const latestPrice = priceRows[0] ?? null;

    const yesPrice = latestPrice?.yesPrice ?? null;
    const noPrice = latestPrice?.noPrice ?? null;

    // 3. Interpolate prompt
    const interpolated = interpolatePrompt(prompt, {
      title: market.title,
      description: market.description ?? "",
      yesPrice: yesPrice ?? 0.5,
      noPrice: noPrice ?? 0.5,
      category: market.category ?? "",
      endDate: market.endDate ?? "",
    });

    // 4. Call Workers AI
    let responseText = "";
    try {
      const aiResponse: any = await c.env.AI.run(model as any, {
        messages: [
          {
            role: "system",
            content:
              "You are a prediction market analyst. Respond with ONLY valid JSON.",
          },
          { role: "user", content: interpolated },
        ],
      });

      responseText =
        typeof aiResponse === "string"
          ? aiResponse
          : aiResponse?.response ?? aiResponse?.result ?? "";
    } catch (err) {
      responseText = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 5. Parse response
    const parsed = parsePickerResponse(responseText);

    results.push({
      marketId,
      title: market.title,
      yesPrice,
      noPrice,
      prompt: interpolated,
      response: responseText,
      parsed,
    });
  }

  return c.json(results);
});

export default app;
