// LLM client (A2), with a fake Anthropic client: request shape, zod validation, error mapping.
import { describe, expect, test, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { ClassifyRequest } from "@/contracts";
import { LlmError, anthropicClassifier, parseLlmOutput } from "@/lib/classifier/llm";

const cart: ClassifyRequest = {
  cartId: "cart_t",
  currency: "USD",
  userId: "demo-user",
  subtotalCents: 24900,
  items: [{ productId: "flight-jfk-lax", name: "JFK → LAX", description: "Flight", unitPriceCents: 24900, quantity: 1 }],
};

function fakeClient(reply: string | Error) {
  const create = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return {
      content: [{ type: "text", text: reply }],
      usage: { input_tokens: 900, output_tokens: 40 },
      stop_reason: "end_turn",
    };
  });
  return { create, client: { messages: { create } } as unknown as Pick<Anthropic, "messages"> };
}

const kindOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: LlmError) => e.kind);

describe("parseLlmOutput()", () => {
  test("accepts valid output and normalizes enum casing", () => {
    expect(parseLlmOutput('{"category":"Air_Travel","confidence":0.9,"reason":"A flight."}')).toEqual({
      category: "air_travel",
      confidence: 0.9,
      reason: "A flight.",
    });
  });

  test.each([
    ["not JSON", "sure! air_travel"],
    ["unknown category", '{"category":"crypto","confidence":0.9,"reason":"x"}'],
    ["confidence > 1", '{"category":"general","confidence":1.4,"reason":"x"}'],
    ["empty reason", '{"category":"general","confidence":0.5,"reason":""}'],
    ["reason too long", JSON.stringify({ category: "general", confidence: 0.5, reason: "x".repeat(301) })],
    ["missing field", '{"category":"general","reason":"x"}'],
  ])("rejects %s as invalid_output", (_, text) => {
    expect(() => parseLlmOutput(text)).toThrow(LlmError);
    try {
      parseLlmOutput(text);
    } catch (e) {
      expect((e as LlmError).kind).toBe("invalid_output");
    }
  });
});

describe("anthropicClassifier()", () => {
  test("sends Haiku 5.5 a JSON-schema request with capped tokens and no temperature", async () => {
    const { create, client } = fakeClient('{"category":"air_travel","confidence":0.95,"reason":"A flight."}');
    const result = await anthropicClassifier({ client })(cart);
    expect(result.category).toBe("air_travel");
    const req = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(req).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 300, output_config: { format: { type: "json_schema" } } });
    expect(req).not.toHaveProperty("temperature");
  });

  test("maps SDK errors to typed kinds for the A3 fallback", async () => {
    const run = (err: Error) => kindOf(anthropicClassifier({ client: fakeClient(err).client })(cart));
    expect(await run(new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()))).toBe("rate_limited");
    expect(await run(new Anthropic.APIConnectionTimeoutError())).toBe("timeout");
    expect(await run(new Anthropic.InternalServerError(500, undefined, "boom", new Headers()))).toBe("api_error");
  });

  test("invalid model output surfaces as invalid_output", async () => {
    const { client } = fakeClient('{"category":"general","confidence":2,"reason":"x"}');
    expect(await kindOf(anthropicClassifier({ client })(cart))).toBe("invalid_output");
  });

  test("missing LLM_API_KEY is not_configured", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    expect(await kindOf(anthropicClassifier()(cart))).toBe("not_configured");
    vi.unstubAllEnvs();
  });
});
