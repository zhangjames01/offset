// classify() + POST /api/classify in LLM_MODE=live / rules (A2, A3), with a fake LLM. No network.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClassifyResponse, type ClassifyRequest, type LlmClassification } from "@/contracts";
import { classify, mockClassifyStore, resetClassifyGuards } from "@/lib/classifier";
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

beforeEach(() => {
  resetStore();
  resetClassifyGuards();
});
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

  test("ignores client-sent prices and subtotal for catalog products", async () => {
    const seen: ClassifyRequest[] = [];
    const spy = async (c: ClassifyRequest) => (seen.push(c), mockLikeLlm(c));
    const tampered = {
      ...flightCart,
      subtotalCents: 1,
      items: [{ ...flightCart.items[0], unitPriceCents: 999_999 }],
    };
    const got = await classify(tampered, { llm: spy, store: mockClassifyStore, now: NOV });
    expect(got.suggestedDonationCents).toBe(747); // 3% of the catalog's 24900
    expect(seen[0].items[0].unitPriceCents).toBe(24900); // the LLM sees trusted prices too
    expect(seen[0].subtotalCents).toBe(24900);
  });

  test("unknown products keep the client price (checkout rejects them anyway)", async () => {
    const odd = {
      ...flightCart,
      items: [{ ...flightCart.items[0], productId: "not-in-catalog", unitPriceCents: 10_000 }],
    };
    const llm = async () => ({ category: "air_travel" as const, confidence: 0.9, reason: "A flight." });
    const got = await classify(odd, { llm, store: mockClassifyStore, now: NOV });
    expect(got.suggestedDonationCents).toBe(300);
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

  test.each(["invalid_output", "timeout", "rate_limited", "api_error", "not_configured"] as const)(
    "LlmError %s → rules fallback (200, source rules), details logged not returned",
    async (kind) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      fakeLlm = async () => {
        throw new LlmError(kind, "secret detail: invalid x-api-key");
      };
      const res = await post(flightCart);
      expect(res.status).toBe(200);
      const raw = await res.text();
      const body = ClassifyResponse.parse(JSON.parse(raw));
      expect(body).toMatchObject({ category: "air_travel", donationCents: 500, source: "rules" });
      expect(raw).not.toContain("secret detail");
      expect(log).toHaveBeenCalledWith(`[classify] ${kind}: secret detail: invalid x-api-key → rules fallback`);
      log.mockRestore();
    },
  );

  test("same cart again → source cache, no second LLM call, fresh id", async () => {
    let calls = 0;
    fakeLlm = async (c) => (calls++, mockLikeLlm(c));
    const first = ClassifyResponse.parse(await (await post(flightCart)).json());
    const second = ClassifyResponse.parse(await (await post({ ...flightCart, cartId: "other" })).json());
    expect(calls).toBe(1);
    expect(first.source).toBe("llm");
    expect(second).toMatchObject({ ...first, classificationId: second.classificationId, source: "cache" });
    expect(second.classificationId).not.toBe(first.classificationId);
  });

  test("failed LLM results are not cached: the next call tries the LLM again", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeLlm = async () => {
      throw new LlmError("timeout", "slow");
    };
    expect(ClassifyResponse.parse(await (await post(flightCart)).json()).source).toBe("rules");
    fakeLlm = mockLikeLlm;
    expect(ClassifyResponse.parse(await (await post(flightCart)).json()).source).toBe("llm");
    log.mockRestore();
  });

  test("over 20 LLM calls per IP per minute → rules; cache hits don't count; other IPs unaffected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    fakeLlm = async (c) => (calls++, mockLikeLlm(c));
    const from = (ip: string, n: number) =>
      POST(
        new Request("http://test/api/classify", {
          method: "POST",
          headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
          // A different quantity each time → a different cart → a cache miss.
          body: JSON.stringify({ ...flightCart, items: [{ ...flightCart.items[0], quantity: n }] }),
        }),
      ).then(async (r) => ClassifyResponse.parse(await r.json()).source);

    for (let n = 1; n <= 20; n++) expect(await from("1.1.1.1", n)).toBe("llm");
    expect(await from("1.1.1.1", 21)).toBe("rules");
    expect(await from("1.1.1.1", 1)).toBe("cache"); // still served from cache
    expect(await from("2.2.2.2", 21)).toBe("llm");
    expect(calls).toBe(21);
    warn.mockRestore();
  });

  test("bad body is still VALIDATION_ERROR", async () => {
    const res = await post({ cartId: 1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/classify, LLM_MODE=rules", () => {
  beforeEach(() => vi.stubEnv("LLM_MODE", "rules"));

  test("classifies every demo cart without the LLM, same amounts as the canned mocks", async () => {
    fakeLlm = async () => {
      throw new Error("LLM must not be called in rules mode");
    };
    for (const { request } of carts.slice(0, 6)) {
      const res = await POST(
        new Request("http://test/api/classify", { method: "POST", body: JSON.stringify(request) }),
      );
      expect(res.status).toBe(200);
      const body = ClassifyResponse.parse(await res.json());
      const m = mockClassifyByProduct[request.items[0].productId];
      const pick = (r: ClassifyResponse) => [r.category, r.causeId, r.suggestedDonationCents, r.donationCents, r.maxDonationCents, r.rateRule, r.adjustment];
      expect(pick(body)).toEqual(pick(m));
      expect(body.source).toBe("rules");
    }
  });
});
