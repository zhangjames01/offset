import { describe, expect, test } from "vitest";
import type { ClassifyRequest, ClassifyResponse } from "@/contracts";
import { type ClassifyStore, classify, mockClassifyStore } from "@/lib/classifier";
import { type LabeledCart, donationChecks, isCorrect, reasonChecks, scoreCart, summarize } from "@/lib/classifier/eval";
import { mockPreferences } from "@/lib/mocks";
import cartsJson from "@/tests/fixtures/carts.json";

const carts = cartsJson.carts as unknown as (LabeledCart & { request: ClassifyRequest })[];
const prefs = mockPreferences;
const evalStore: ClassifyStore = {
  ...mockClassifyStore,
  getPreferences: async () => prefs,
  getMonthToDateCents: async () => 0,
  newClassificationId: () => "cls_eval",
  save: async () => {},
};

const response = (over: Partial<ClassifyResponse>): ClassifyResponse => ({
  classificationId: "cls_x",
  category: "air_travel",
  confidence: 0.9,
  causeId: "carbon_removal",
  causeName: "Carbon removal",
  suggestedDonationCents: 747,
  donationCents: 500,
  maxDonationCents: 500,
  rateRule: "3% of fare",
  reason: "A one-way economy flight.",
  adjustment: "per_order_max",
  source: "llm",
  ...over,
});

describe("carts.json for the A5 eval", () => {
  test("has 30 carts: 8 demo, 12 coverage, 10 edge", () => {
    const n = (tag: string) => carts.filter((c) => c.tags.includes(tag)).length;
    expect([carts.length, n("demo"), n("coverage"), n("edge")]).toEqual([30, 8, 12, 10]);
  });
});

describe("eval scoring", () => {
  const flight = carts[0];
  const giftCard = carts.find((c) => c.request.items[0].productId === "gift-card-50")!;
  const mealKit = carts.find((c) => c.acceptCategories?.length)!;

  test("low confidence only counts for carts labeled low", () => {
    expect(isCorrect(giftCard, response({ category: "general", confidence: 0.3 }))).toBe(true);
    expect(isCorrect(giftCard, response({ category: "general", confidence: 0.8 }))).toBe(false);
    expect(isCorrect(flight, response({ category: "general", confidence: 0.3 }))).toBe(false);
  });

  test("acceptCategories count as correct", () => {
    expect(isCorrect(mealKit, response({ category: mealKit.acceptCategories![0] }))).toBe(true);
    expect(isCorrect(mealKit, response({ category: "general" }))).toBe(false);
  });

  test("reason checks catch money, ids and the word category", () => {
    const failing = (r: string) => reasonChecks(r).filter((c) => !c.ok).map((c) => c.name);
    expect(failing("A flight from New York to Los Angeles.")).toEqual([]);
    expect(failing("Adds $7.47, which is 3% of the fare.")).toEqual(["reason has no money or rates"]);
    expect(failing("This is air_travel.")).toEqual(["reason has no category ids"]);
    expect(failing("Flights fit the air travel category.")).toEqual(["reason doesn't say \"category\""]);
    expect(failing("x".repeat(201))).toEqual(["reason ≤ 200 chars"]);
  });

  test("amounts quoted from the cart's own text are allowed", () => {
    const failing = (r: string, cartText: string) =>
      reasonChecks(r, cartText).filter((c) => !c.ok).map((c) => c.name);
    expect(failing("A $50 gift card for many stores.", "$50 gift card Digital gift card")).toEqual([]);
    expect(failing("A $5 donation for a $50 gift card.", "$50 gift card")).toEqual(["reason has no money or rates"]);
    expect(failing("A $50 gift card.", "$500 gift card")).toEqual(["reason has no money or rates"]);
  });

  test("donation checks catch a broken cap or opt-out", () => {
    const failing = (r: ClassifyResponse) => donationChecks(r, prefs).filter((c) => !c.ok).map((c) => c.name);
    expect(failing(response({}))).toEqual([]);
    expect(failing(response({ donationCents: 700 }))).toEqual(["donation ≤ edit limit"]);
    expect(failing(response({ category: "single_use_packaging", donationCents: 0, adjustment: null }))).toEqual([
      "opted-out category gives 0¢",
    ]);
  });

  test("soft checks warn but don't fail the eval", () => {
    const s = scoreCart(flight, response({ reason: "A flight, so this category fits." }), {
      mode: "live",
      ms: 900,
      timeoutMs: 4_000,
      prefs,
    });
    const sum = summarize([flight], [s]);
    expect(sum.warnings).toEqual([{ name: "reason doesn't say \"category\"", ids: [flight.id] }]);
    expect(sum.failedChecks).toEqual([]);
    expect(sum.passed).toBe(true);
  });

  test("live mode also checks the source and the timeout", () => {
    const s = scoreCart(flight, response({ source: "rules" }), { mode: "live", ms: 4_100, timeoutMs: 4_000, prefs });
    expect(s.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["answered by the LLM", "under the timeout"]);
  });
});

describe("rules classifier on the eval carts (the fallback the demo shows without a key)", async () => {
  const scores = [];
  for (const c of carts) {
    const r = await classify(c.request, { store: evalStore });
    scores.push(scoreCart(c, r, { mode: "rules", ms: 0, timeoutMs: 4_000, prefs }));
  }
  const sum = summarize(carts, scores);

  test("gets every demo cart right", () => {
    expect(sum.groups.find((g) => g.group === "demo")).toMatchObject({ correct: 8, total: 8 });
  });

  test("passes every guardrail", () => {
    expect(sum.failedChecks).toEqual([]);
  });

  test("overall accuracy doesn't regress", () => {
    const all = sum.groups[0];
    expect(all.correct / all.total).toBeGreaterThanOrEqual(RULES_FLOOR);
  });
});

/** Rules-mode accuracy on all 30 carts when A5 landed; raise it if rules.ts improves. */
const RULES_FLOOR = 0.7;
