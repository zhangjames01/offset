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

  test("numbers without a currency word are not money", () => {
    expect(rulesExtract("3 flights a month, I care about climate").budget).toBeNull();
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
