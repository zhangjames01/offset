// classify() + POST /api/classify in LLM_MODE=live (A2), with a fake LLM. No network.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, ClassifyResponse, type ClassifyRequest, type LlmClassification } from "@/contracts";
import { classify, mockClassifyStore } from "@/lib/classifier";
import { LlmError } from "@/lib/classifier/llm";
import { mockClassifyByProduct } from "@/lib/mocks";
import { resetStore, store } from "@/lib/mock-store";
import cartsJson from "@/tests/fixtures/carts.json";

// The route builds its LLM via anthropicClassifier(); swap in a controllable fake.
let fakeLlm: (cart: ClassifyRequest) => Promise<LlmClassification>;
vi.mock("@/lib/classifier/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/classifier/llm")>()),
  anthropicClassifier: () => (cart: ClassifyRequest) => fakeLlm(cart),
}));
import { POST } from "@/app/api/classify/route";

const carts = cartsJson.carts.map((c) => ({ ...c, request: c.request as ClassifyRequest }));
const flightCart = carts.find((c) => c.request.items[0].productId === "flight-jfk-lax")!.request;
const NOV = () => new Date("2026-11-04T12:00:00Z");

/** Answers like the canned mocks would, keyed by the cart's first product. */
const mockLikeLlm = async (cart: ClassifyRequest): Promise<LlmClassification> => {
  const m = mockClassifyByProduct[cart.items[0].productId];
  return { category: m.category, confidence: m.confidence, reason: m.reason };
};

beforeEach(() => resetStore());
afterEach(() => vi.unstubAllEnvs());

describe("classify()", () => {
  test.each(carts.slice(0, 6).map((c) => [c.request.items[0].productId, c.request] as const))(
    "%s: amounts match the canned mock",
    async (id, cart) => {
      const got = await classify(cart, { llm: mockLikeLlm, store: mockClassifyStore, now: NOV });
      const { classificationId, ...want } = mockClassifyByProduct[id];
      expect(classificationId).toBeTruthy();
      expect(got).toMatchObject({ ...want, source: "llm" });
      expect(store().classifications.get(got.classificationId)).toEqual(got);
    },
  );

  test("prices from line items, not the client-sent subtotal", async () => {
    const tampered = { ...flightCart, subtotalCents: 1 };
    const got = await classify(tampered, { llm: mockLikeLlm, store: mockClassifyStore, now: NOV });
    expect(got.suggestedDonationCents).toBe(747);
  });

  test("month-to-date only counts the current UTC month", async () => {
    expect(await mockClassifyStore.getMonthToDateCents("demo-user", NOV())).toBe(650);
    expect(await mockClassifyStore.getMonthToDateCents("demo-user", new Date("2026-12-01T00:00:00Z"))).toBe(0);
    expect(await mockClassifyStore.getMonthToDateCents("someone-else", NOV())).toBe(0);
  });
});

describe("POST /api/classify, LLM_MODE=live", () => {
  const post = (body: unknown) =>
    POST(new Request("http://test/api/classify", { method: "POST", body: JSON.stringify(body) }));

  beforeEach(() => vi.stubEnv("LLM_MODE", "live"));

  test("returns a contract-valid response from the LLM path", async () => {
    fakeLlm = mockLikeLlm;
    const res = await post(flightCart);
    expect(res.status).toBe(200);
    const body = ClassifyResponse.parse(await res.json());
    expect(body).toMatchObject({ category: "air_travel", donationCents: 500, source: "llm" });
    expect(body.classificationId).toMatch(/^cls_/);
  });

  test.each([
    ["invalid_output", 502],
    ["timeout", 502],
    ["rate_limited", 502],
    ["not_configured", 503],
  ] as const)("LlmError %s → CLASSIFY_FAILED %i (until A3 adds the fallback)", async (kind, status) => {
    fakeLlm = async () => {
      throw new LlmError(kind, kind);
    };
    const res = await post(flightCart);
    expect(res.status).toBe(status);
    expect(ApiError.parse(await res.json()).error.code).toBe("CLASSIFY_FAILED");
  });

  test("bad body is still VALIDATION_ERROR", async () => {
    const res = await post({ cartId: 1 });
    expect(res.status).toBe(400);
  });
});
