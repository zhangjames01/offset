// Rates + caps (A2). The canned mocks were written by hand from the plan's rules,
// so price() must reproduce every one of them exactly.
import { describe, expect, test } from "vitest";
import { RATE_RULES, type Category } from "@/contracts";
import { price, type PricingInput } from "@/lib/classifier/pricing";
import { RATES } from "@/lib/classifier/rates";
import { mockCatalog, mockClassifyByProduct, mockPreferences } from "@/lib/mocks";

const MTD = 650; // demo-user's Nov entries in mocks/ledger.json (50 + 100 + 500)
const prefs = mockPreferences;
const input = (o: Partial<PricingInput>): PricingInput => ({
  category: "general",
  confidence: 0.9,
  subtotalCents: 1000,
  prefs,
  monthToDateCents: MTD,
  ...o,
});

describe("price()", () => {
  test.each(mockCatalog.products.map((p) => [p.id, p] as const))("reproduces mocks/classify/%s.json", (id, p) => {
    const m = mockClassifyByProduct[id];
    const got = price(input({ category: m.category, confidence: m.confidence, subtotalCents: p.priceCents }));
    expect(got).toEqual({
      category: m.category,
      causeId: m.causeId,
      suggestedDonationCents: m.suggestedDonationCents,
      donationCents: m.donationCents,
      maxDonationCents: m.maxDonationCents,
      rateRule: m.rateRule,
      adjustment: m.adjustment,
    });
  });

  test("monthly cap binds when less is left than the per-order max", () => {
    const got = price(input({ category: "air_travel", subtotalCents: 24900, monthToDateCents: 1300 }));
    expect(got).toMatchObject({ suggestedDonationCents: 747, donationCents: 200, maxDonationCents: 200, adjustment: "monthly_cap" });
  });

  test("maxDonationCents bounds edits even when no cap changed the suggestion", () => {
    // Demo order 3: $15/mo cap, $11.50 given so far → $3.50 left; the tee's 50¢ fits, so no adjustment.
    const got = price(input({ category: "fast_fashion", subtotalCents: 2499, monthToDateCents: 1150 }));
    expect(got).toMatchObject({ donationCents: 50, adjustment: null, maxDonationCents: 350 });
    // Opt-outs only change the suggestion, not the bound.
    expect(price(input({ category: "single_use_packaging" })).maxDonationCents).toBe(500);
  });

  test("monthly cap already spent → 0", () => {
    const got = price(input({ category: "food_delivery", monthToDateCents: 2000 }));
    expect(got).toMatchObject({ donationCents: 0, maxDonationCents: 0, adjustment: "monthly_cap" });
  });

  test("low confidence moves to general at 100¢, or 0 if general is opted out", () => {
    expect(price(input({ category: "fast_fashion", confidence: 0.59 }))).toMatchObject({
      category: "general",
      causeId: "general_fund",
      donationCents: 100,
      adjustment: "low_confidence",
    });
    const noGeneral = { ...prefs, optOutCategories: ["general" as Category] };
    expect(price(input({ category: "fast_fashion", confidence: 0.2, prefs: noGeneral }))).toMatchObject({
      donationCents: 0,
      adjustment: "low_confidence",
    });
  });

  test("opt-out wins over low confidence", () => {
    const got = price(input({ category: "single_use_packaging", confidence: 0.3 }));
    expect(got).toMatchObject({ category: "single_use_packaging", donationCents: 0, adjustment: "opted_out" });
  });

  test("rates are integer cents and labels match the contract", () => {
    expect(RATES.general(1500)).toBe(100);
    expect(RATES.general(1401)).toBe(99);
    expect(RATES.air_travel(1)).toBe(0);
    for (const c of Object.keys(RATES) as Category[]) {
      expect(Number.isInteger(RATES[c](12345)), c).toBe(true);
      expect(price(input({ category: c, prefs: { ...prefs, optOutCategories: [] } })).rateRule).toBe(RATE_RULES[c]);
    }
  });
});
