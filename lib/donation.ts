// Donation card decisions (H3). Pure functions so they're unit-testable; H4 sends toCreateOrderRequest().
import type { Adjustment, ClassifyResponse, CreateOrderRequest, UserAction } from "@/contracts";
import type { Cart } from "@/lib/cart";

export type Decision = { action: UserAction; cents: number };

export function defaultDecision(c: ClassifyResponse): Decision {
  return { action: "accepted", cents: c.donationCents };
}

/**
 * Highest amount the edit input allows: the classifier's maxDonationCents, i.e.
 * min(per-order max, what's left of the monthly cap). create-order re-checks it, so this is UX only.
 */
export function maxEditCents(c: ClassifyResponse): number {
  return c.maxDonationCents;
}

/** "2.50" / "$2.5" / "3" / ".50" → cents. null if not a valid non-negative amount with at most 2 decimals. */
export function parseDollars(text: string): number | null {
  const m = text.trim().replace(/^\$/, "").match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m || (!m[1] && !m[2])) return null; // needs at least one digit
  return Number(m[1] || 0) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Validates an edit. Editing back to the suggested amount counts as accepting it. */
export function applyEdit(
  c: ClassifyResponse,
  text: string,
  maxCents: number,
): { ok: true; decision: Decision } | { ok: false; error: string } {
  const cents = parseDollars(text);
  if (cents === null) return { ok: false, error: "Enter an amount like 2.50" };
  if (cents > maxCents) return { ok: false, error: `Max is ${formatUsd(maxCents)} for this order` };
  if (cents === 0) return { ok: true, decision: { action: "removed", cents: 0 } };
  return { ok: true, decision: { action: cents === c.donationCents ? "accepted" : "edited", cents } };
}

/** What the order actually carries. A removed donation is 0. */
export function donationCents(d: Decision): number {
  return d.action === "removed" ? 0 : d.cents;
}

export function toCreateOrderRequest(cart: Cart, c: ClassifyResponse, d: Decision): CreateOrderRequest {
  return {
    cartId: cart.id,
    items: cart.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
    donation: {
      classificationId: c.classificationId,
      donationCents: donationCents(d),
      causeId: c.causeId,
      userAction: d.action,
    },
  };
}

export const CATEGORY_LABEL: Record<ClassifyResponse["category"], string> = {
  air_travel: "Air travel",
  fast_fashion: "Fast fashion",
  food_delivery: "Food delivery",
  single_use_packaging: "Single-use packaging",
  general: "General",
};

export function adjustmentNote(c: ClassifyResponse): string | null {
  const notes: Record<Adjustment, string> = {
    per_order_max: `Capped at your per-order max (suggested ${formatUsd(c.suggestedDonationCents)}).`,
    monthly_cap: `Reduced to fit your monthly cap (suggested ${formatUsd(c.suggestedDonationCents)}).`,
    opted_out: "You opted out of this category, so no donation is suggested.",
    low_confidence: "We weren't sure how to categorize this order, so it goes to the general fund.",
  };
  return c.adjustment ? notes[c.adjustment] : null;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
