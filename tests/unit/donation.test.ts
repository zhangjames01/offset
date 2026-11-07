import { describe, expect, it } from "vitest";
import { CreateOrderRequest } from "@/contracts";
import { cartReducer, emptyCart } from "@/lib/cart";
import {
  adjustmentNote,
  applyEdit,
  defaultDecision,
  maxEditCents,
  parseDollars,
  toCreateOrderRequest,
} from "@/lib/donation";
import { mockCatalog, mockClassifyByProduct } from "@/lib/mocks";

const flight = mockClassifyByProduct["flight-jfk-lax"]; // 500¢, per_order_max
const tee = mockClassifyByProduct["tee-3pack"]; // 50¢, no adjustment

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

  it("uses the remaining monthly room as the max when capped monthly", () => {
    expect(maxEditCents({ ...tee, adjustment: "monthly_cap", donationCents: 120 }, 500)).toBe(120);
    expect(maxEditCents(flight, 500)).toBe(500);
    expect(maxEditCents(flight, null)).toBe(747);
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
