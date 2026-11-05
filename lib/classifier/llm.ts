/**
 * Live LLM call (A2): Claude Haiku 5.5 with JSON-schema output, validated by zod.
 * No retries here. Every failure is a typed LlmError so A3 can switch to the rules
 * classifier on invalid_output / timeout / rate_limited.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Category, LlmClassification, type ClassifyRequest } from "@/contracts";
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, cartPrompt } from "./prompt";

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const TIMEOUT_MS = 4_000;
export const MAX_TOKENS = 300;

export type LlmErrorKind = "not_configured" | "invalid_output" | "timeout" | "rate_limited" | "api_error";

export class LlmError extends Error {
  constructor(
    public kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** What classify() depends on. Tests pass a fake. */
export type LlmClassifier = (cart: ClassifyRequest) => Promise<LlmClassification>;

/** Raw model text → validated LlmClassification. Enum values are compared case-insensitively. */
export function parseLlmOutput(text: string): LlmClassification {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LlmError("invalid_output", "Model output was not JSON");
  }
  if (raw && typeof raw === "object" && "category" in raw && typeof raw.category === "string") {
    const lower = raw.category.trim().toLowerCase();
    if ((Category.options as readonly string[]).includes(lower)) raw = { ...raw, category: lower };
  }
  const parsed = LlmClassification.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new LlmError("invalid_output", `Model output failed validation: ${first?.path.join(".")} ${first?.message}`);
  }
  return parsed.data;
}

type MessagesClient = Pick<Anthropic, "messages">;

export function anthropicClassifier(opts: { client?: MessagesClient; model?: string } = {}): LlmClassifier {
  const model = opts.model ?? (process.env.LLM_MODEL || DEFAULT_MODEL);
  let client = opts.client;

  return async (cart) => {
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
        messages: [{ role: "user", content: cartPrompt(cart) }],
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      });
    } catch (err) {
      throw toLlmError(err);
    }
    console.info(
      `[classify] ${model} ${Date.now() - started}ms in=${msg.usage.input_tokens} out=${msg.usage.output_tokens} stop=${msg.stop_reason}`,
    );
    const text = msg.content.find((b) => b.type === "text")?.text;
    if (!text) throw new LlmError("invalid_output", `No text in response (stop_reason=${msg.stop_reason})`);
    return parseLlmOutput(text);
  };
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.RateLimitError) return new LlmError("rate_limited", "LLM rate limited (429)");
  if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIUserAbortError) {
    return new LlmError("timeout", `LLM timed out after ${TIMEOUT_MS}ms`);
  }
  if (err instanceof Anthropic.APIError) {
    // Keep Anthropic's own message (e.g. "invalid x-api-key"); it never contains the key.
    const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
    return new LlmError("api_error", `LLM API error ${err.status ?? ""}${detail ? `: ${detail}` : ""}`.trim());
  }
  return new LlmError("api_error", err instanceof Error ? err.message : "Unknown LLM error");
}
