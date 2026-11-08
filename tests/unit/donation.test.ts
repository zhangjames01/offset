import { describe, expect, it } from "vitest";
import { CreateOrderRequest } from "@/contracts";
import { cartReducer, emptyCart } from "@/lib/cart";
import {
  adjustmentNote,
  applyEdit,
  defaultDecision,
  fitDecision,
  maxEditCents,
  parseDollars,
  toCreateOrderRequest,
} from "@/lib/donation";
import { mockCatalog, mockClassifyByProduct } from "@/lib/mocks";

const flight = mockClassifyByProduct["flight-jfk-lax"]; // 500¢, per_order_max
const tee = mockClassifyByProduct["tee-3pack"]; // 50¢, no adjustment

describe("fitDecision (re-classify after a create-order failure)", () => {
  const c = { ...tee, donationCents: 50, maxDonationCents: 300 };
  it("keeps removed, keeps an edit that still fits, otherwise takes the new suggestion", () => {
    expect(fitDecision({ action: "removed", cents: 0 }, c)).toEqual({ action: "removed", cents: 0 });
    expect(fitDecision({ action: "edited", cents: 200 }, c)).toEqual({ action: "edited", cents: 200 });
    expect(fitDecision({ action: "edited", cents: 400 }, c)).toEqual({ action: "accepted", cents: 50 });
    expect(fitDecision({ action: "accepted", cents: 80 }, c)).toEqual({ action: "accepted", cents: 50 });
  });
});

describe("donation card logic", () => {
  it("parses dollar input to integer cents", () => {
    expect(parseDollars("2.5")).toBe(250);
    expect(parseDollars("$3")).toBe(300);
    expect(parseDollars("0.07")).toBe(7);
    expect(parseDollars(".50")).toBe(50);
    for (const bad of ["", ".", "$", "-1", "1.234", "abc", "1e3"]) expect(parseDollars(bad)).toBeNull();
  });

  it("bounds edits and classifies the user action", () => {
    expect(applyEdit(tee, "9.99", 500)).toEqual({ ok: false, error: "Max is $5.00 for this order" });
    expect(applyEdit(tee, "2", 500)).toEqual({ ok: true, decision: { action: "edited", cents: 200 } });
    expect(applyEdit(tee, "0.50", 500)).toEqual({ ok: true, decision: { action: "accepted", cents: 50 } });
    expect(applyEdit(tee, "0", 500)).toEqual({ ok: true, decision: { action: "removed", cents: 0 } });
  });

  it("bounds edits by the classifier's maxDonationCents (per-order max and monthly room)", () => {
    expect(maxEditCents(flight)).toBe(500);
    // Demo: $3.50 left this month, tee suggestion untouched → the edit max is $3.50, not the $5 per-order max.
    const late = { ...tee, maxDonationCents: 350 };
    expect(maxEditCents(late)).toBe(350);
    expect(applyEdit(late, "4", maxEditCents(late))).toEqual({ ok: false, error: "Max is $3.50 for this order" });
  });

  it("explains adjustments", () => {
    expect(adjustmentNote(flight)).toContain("per-order max");
    expect(adjustmentNote(tee)).toBeNull();
  });

  it("builds a contract-valid create-order body; removed sends 0", () => {
    const cart = cartReducer(emptyCart("cart_t"), { type: "add", product: mockCatalog.products[0] });
    const accepted = CreateOrderRequest.parse(toCreateOrderRequest(cart, flight, defaultDecision(flight)));
    expect(accepted.donation).toEqual({ classificationId: flight.classificationId, donationCents: 500, causeId: "carbon_removal", userAction: "accepted" });
    const removed = toCreateOrderRequest(cart, flight, { action: "removed", cents: 0 });
    expect(removed.donation.donationCents).toBe(0);
  });
});
