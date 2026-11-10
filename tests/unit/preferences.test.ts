import { describe, expect, it } from "vitest";
import { SavePreferencesRequest } from "@/contracts";
import { finalizeDraft, toDraft, toggle } from "@/lib/preferences";
import { mockPreferences } from "@/lib/mocks";

const draft = toDraft(mockPreferences);

describe("preferences page logic", () => {
  it("toggles chips", () => {
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
    expect(toggle(["b"], "a")).toEqual(["b", "a"]);
  });

  it("builds a contract-valid save body", () => {
    const r = finalizeDraft(draft, { monthly: "20", perOrder: "4.50" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const body = SavePreferencesRequest.parse(r.draft);
      expect([body.monthlyCapCents, body.perOrderMaxCents]).toEqual([2000, 450]);
    }
  });

  it("caps manual limits at the parser's ceilings ($100/month, $25/order)", () => {
    expect(finalizeDraft(draft, { monthly: "5000", perOrder: "900" })).toEqual({
      ok: false,
      errors: { monthly: "Max is $100.00", perOrder: "Max is $25.00" },
    });
    expect(finalizeDraft(draft, { monthly: "100", perOrder: "25" }).ok).toBe(true);
  });

  it("rejects bad caps and an empty cause list", () => {
    const r = finalizeDraft({ ...draft, causes: [] }, { monthly: "abc", perOrder: "5" });
    expect(r).toEqual({ ok: false, errors: { monthly: "Enter an amount like 15.00", causes: "Pick at least one cause" } });
    const over = finalizeDraft(draft, { monthly: "5", perOrder: "10" });
    expect(over).toEqual({ ok: false, errors: { perOrder: "Can't be more than the monthly cap" } });
  });
});
