// Cap rules (A4): stated limits → monthlyCapCents / perOrderMaxCents, always erring low.
import { describe, expect, test } from "vitest";
import { CAP_CEILINGS, DEFAULT_CAPS, resolveCaps, toMonthlyCents, type Extracted } from "@/lib/preferences-parser/caps";

const caps = (budget: Extracted["budget"], perOrder: Extracted["perOrder"] = null) => resolveCaps({ budget, perOrder });
const one = (d: number) => ({ lowDollars: d, highDollars: d });

describe("resolveCaps()", () => {
  test("nothing stated → defaults ($10/month, $5/order)", () => {
    expect(caps(null)).toEqual({ monthlyCapCents: 1000, perOrderMaxCents: 500 });
    expect(DEFAULT_CAPS).toEqual({ monthlyCapCents: 1000, perOrderMaxCents: 500 });
  });

  test("exact amounts are taken as written, in cents", () => {
    expect(caps({ ...one(15), period: "month" }, one(2.5))).toEqual({ monthlyCapCents: 1500, perOrderMaxCents: 250 });
  });

  test("a range uses its low end, whichever side it's written on", () => {
    expect(caps({ lowDollars: 10, highDollars: 20, period: "month" })).toMatchObject({ monthlyCapCents: 1000 });
    expect(caps({ lowDollars: 20, highDollars: 10, period: "month" })).toMatchObject({ monthlyCapCents: 1000 });
    expect(caps(null, { lowDollars: 3, highDollars: 4 })).toMatchObject({ perOrderMaxCents: 300 });
  });

  test.each([
    ["week", 500, 2000],
    ["day", 100, 2800],
    ["year", 10000, 833],
    ["year", 1100, 91],
    ["month", 1234, 1234],
  ] as const)("per %s: %i¢ → %i¢ a month", (period, cents, monthly) => {
    expect(toMonthlyCents(cents, period)).toBe(monthly);
  });

  test("ceilings clamp both caps ($100/month, $25/order)", () => {
    expect(CAP_CEILINGS).toEqual({ monthlyCapCents: 10_000, perOrderMaxCents: 2_500 });
    expect(caps({ ...one(1500), period: "month" }, one(500))).toEqual({ monthlyCapCents: 10_000, perOrderMaxCents: 2_500 });
    expect(caps({ ...one(50), period: "week" })).toMatchObject({ monthlyCapCents: 10_000 });
  });

  test("per-order is never more than the monthly cap", () => {
    expect(caps(null, one(20))).toEqual({ monthlyCapCents: 1000, perOrderMaxCents: 1000 });
    expect(caps({ ...one(3), period: "month" })).toEqual({ monthlyCapCents: 300, perOrderMaxCents: 300 });
  });

  test("$0 is a real cap, not 'unstated'", () => {
    expect(caps({ ...one(0), period: "month" })).toEqual({ monthlyCapCents: 0, perOrderMaxCents: 0 });
  });

  test("unusable numbers fall back to the defaults", () => {
    expect(caps({ lowDollars: Number.NaN, highDollars: -1, period: "month" }, { lowDollars: -5, highDollars: Infinity })).toEqual(
      DEFAULT_CAPS,
    );
  });

  test("float dollars round to whole cents", () => {
    expect(caps({ ...one(12.345), period: "month" }, one(0.1 + 0.2))).toEqual({ monthlyCapCents: 1235, perOrderMaxCents: 30 });
  });
});
