// Rules preferences parser (A4): keywords + regex, no network.
import { describe, expect, test } from "vitest";
import { Preferences } from "@/contracts";
import { toPreferences } from "@/lib/preferences-parser";
import { normalize, rulesExtract } from "@/lib/preferences-parser/rules";
import fixtures from "@/tests/fixtures/preferences.json";

const NOW = new Date("2026-11-07T12:00:00Z");
const parse = (t: string) => toPreferences(t, rulesExtract(t), "demo-user", NOW);
const sorted = (xs: string[]) => [...xs].sort();

describe("labeled preference texts (tests/fixtures/preferences.json)", () => {
  test.each(fixtures.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const p = parse(c.rawText);
    expect(Preferences.safeParse(p).success).toBe(true);
    expect(sorted(p.causes)).toEqual(sorted(c.expected.causes));
    expect(sorted(p.optOutCategories)).toEqual(sorted(c.expected.optOutCategories));
    expect([p.monthlyCapCents, p.perOrderMaxCents]).toEqual([c.expected.monthlyCapCents, c.expected.perOrderMaxCents]);
  });

  test("the demo text parses to exactly the mock demo user", async () => {
    const { mockPreferences } = await import("@/lib/mocks");
    const p = parse(mockPreferences.rawText);
    expect({ ...p, updatedAt: mockPreferences.updatedAt }).toEqual(mockPreferences);
  });
});

describe("rulesExtract()", () => {
  test("negated clauses become opt-outs, never causes", () => {
    expect(rulesExtract("I love oceans but skip packaging")).toMatchObject({
      causes: ["ocean_plastic"],
      optOutCategories: ["single_use_packaging"],
    });
    expect(rulesExtract("Don't add anything to flights").causes).toEqual([]);
    expect(rulesExtract("Everything except fast fashion").optOutCategories).toEqual(["fast_fashion"]);
  });

  test("'no more than' / 'not to exceed' are limits, not opt-outs", () => {
    for (const t of ["No more than $5 on flights", "Not to exceed $5 for flights", "Don't spend more than $5 on flights"]) {
      expect(rulesExtract(t), t).toMatchObject({ causes: ["carbon_removal"], optOutCategories: [] });
    }
  });

  test("an amount with no period or per-order wording counts as monthly", () => {
    expect(rulesExtract("Max $15").budget).toEqual({ lowDollars: 15, highDollars: 15, period: "month" });
    expect(rulesExtract("Max $15").perOrder).toBeNull();
  });

  test("words before the amount tag it too", () => {
    expect(rulesExtract("monthly limit $12").budget).toMatchObject({ lowDollars: 12, period: "month" });
    expect(rulesExtract("per order max $3").perOrder).toEqual({ lowDollars: 3, highDollars: 3 });
  });

  test("two limits in one clause are tagged separately", () => {
    expect(rulesExtract("$15 a month and $2 per order")).toMatchObject({
      budget: { lowDollars: 15, period: "month" },
      perOrder: { lowDollars: 2 },
    });
  });

  test("several limits of the same kind → the lowest (after converting periods)", () => {
    expect(rulesExtract("$30 a month. Actually $5 a week.").budget).toMatchObject({ lowDollars: 5, period: "week" });
    expect(rulesExtract("$3 per order, or $2 per purchase").perOrder).toMatchObject({ lowDollars: 2 });
  });

  test("'and' + a negation starts a new clause (PR #10 review)", () => {
    expect(rulesExtract("climate and no flights")).toMatchObject({ causes: ["carbon_removal"], optOutCategories: ["air_travel"] });
    expect(rulesExtract("I love oceans and not packaging")).toMatchObject({
      causes: ["ocean_plastic"],
      optOutCategories: ["single_use_packaging"],
    });
    expect(rulesExtract("skip packaging and no flights")).toMatchObject({
      causes: [],
      optOutCategories: ["single_use_packaging", "air_travel"],
    });
    // "and no more than" is a limit, not an opt-out: the clause stays whole.
    expect(rulesExtract("climate and no more than $5 a month")).toMatchObject({
      causes: ["carbon_removal"],
      optOutCategories: [],
      budget: { lowDollars: 5, period: "month" },
    });
  });

  test("bare numbers count between a limit word and a unit (PR #10 review)", () => {
    expect(rulesExtract("max 15 a month").budget).toEqual({ lowDollars: 15, highDollars: 15, period: "month" });
    expect(rulesExtract("no more than 15 a month").budget).toMatchObject({ lowDollars: 15, period: "month" });
    expect(rulesExtract("cap of 20 per month, limit 3 per order")).toMatchObject({
      budget: { lowDollars: 20, period: "month" },
      perOrder: { lowDollars: 3 },
    });
    expect(rulesExtract("budget 100 yearly").budget).toMatchObject({ lowDollars: 100, period: "year" });
    expect(rulesExtract("max $15 a month, limit 2 per order")).toMatchObject({
      budget: { lowDollars: 15 },
      perOrder: { lowDollars: 2 },
    });
  });

  test("numbers without a currency word, limit word and unit are not money", () => {
    expect(rulesExtract("3 flights a month, I care about climate").budget).toBeNull();
    expect(rulesExtract("limit 3 flights a month").budget).toBeNull();
    expect(rulesExtract("max 15").budget).toBeNull();
    expect(rulesExtract("I fly 2 times a month, max").budget).toBeNull();
  });

  test("Hua's end-to-end text from the PR #10 review", () => {
    const p = parse("Oceans and hunger please. $5-10 a week, never more than $2 an order, no fast fashion.");
    expect(sorted(p.causes)).toEqual(["food_bank", "ocean_plastic"]);
    expect(p.optOutCategories).toEqual(["fast_fashion"]);
    expect([p.monthlyCapCents, p.perOrderMaxCents]).toEqual([2000, 200]);
  });

  test("text with no causes, opt-outs or amounts", () => {
    expect(rulesExtract("hello")).toEqual({ causes: [], optOutCategories: [], budget: null, perOrder: null });
  });
});

describe("normalize()", () => {
  test("thousands separators, trailing $, curly apostrophes", () => {
    expect(normalize("$1,000 or 15$ — don’t")).toBe("$1000 or $15 — don't");
  });
});
