/**
 * Live preferences extraction (A4): Claude Haiku 5.5 with JSON-schema output, validated by zod.
 * Same call settings and error mapping as the classifier (lib/classifier/llm.ts): no retries,
 * 4 s timeout, every failure is a typed LlmError so parsePreferences() can fall back to rules.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Category, CauseId } from "@/contracts";
import { DEFAULT_MODEL, LlmError, MAX_TOKENS, TIMEOUT_MS, toLlmError } from "@/lib/classifier/llm";
import { type Extracted, unique } from "./caps";
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, preferencesPrompt } from "./prompt";

/** What parsePreferences() depends on. Tests pass a fake. */
export type PreferencesExtractor = (rawText: string) => Promise<Extracted>;

const Dollars = z.number().finite().nonnegative().max(1_000_000);
const Limit = z.object({ given: z.boolean(), lowDollars: Dollars, highDollars: Dollars });

export const LlmPreferences = z.object({
  causes: z.array(CauseId).max(10),
  optOutCategories: z.array(Category).max(10),
  budget: Limit.extend({ period: z.enum(["month", "week", "day", "year"]) }),
  perOrder: Limit,
});

/** Raw model text → Extracted. given=false limits become null (caps.ts then uses the defaults). */
export function parseLlmPreferences(text: string): Extracted {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LlmError("invalid_output", "Model output was not JSON");
  }
  const parsed = LlmPreferences.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new LlmError("invalid_output", `Model output failed validation: ${first?.path.join(".")} ${first?.message}`);
  }
  const { causes, optOutCategories, budget, perOrder } = parsed.data;
  return {
    causes: unique(causes),
    optOutCategories: unique(optOutCategories),
    budget: budget.given ? { lowDollars: budget.lowDollars, highDollars: budget.highDollars, period: budget.period } : null,
    perOrder: perOrder.given ? { lowDollars: perOrder.lowDollars, highDollars: perOrder.highDollars } : null,
  };
}

type MessagesClient = Pick<Anthropic, "messages">;

export function anthropicPreferencesExtractor(opts: { client?: MessagesClient; model?: string } = {}): PreferencesExtractor {
  const model = opts.model ?? (process.env.LLM_MODEL || DEFAULT_MODEL);
  let client = opts.client;

  return async (rawText) => {
    if (!client) {
      if (!process.env.LLM_API_KEY) throw new LlmError("not_configured", "LLM_API_KEY is not set");
      client = new Anthropic({ apiKey: process.env.LLM_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
    }
    const started = Date.now();
    let msg: Anthropic.Message;
    try {
      msg = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: preferencesPrompt(rawText) }],
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      });
    } catch (err) {
      throw toLlmError(err);
    }
    console.info(
      `[prefs] ${model} ${Date.now() - started}ms in=${msg.usage.input_tokens} out=${msg.usage.output_tokens} stop=${msg.stop_reason}`,
    );
    const text = msg.content.find((b) => b.type === "text")?.text;
    if (!text) throw new LlmError("invalid_output", `No text in response (stop_reason=${msg.stop_reason})`);
    return parseLlmPreferences(text);
  };
}
