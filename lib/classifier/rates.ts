/**
 * Rate table: the ONLY place donation amounts come from. The LLM never sees or
 * returns money. Labels must stay in sync with RATE_RULES in contracts/common.ts.
 * All math is integer cents; percentages are basis points to avoid float drift.
 */
import type { Category } from "@/contracts";

type Rate = (subtotalCents: number) => number;

const pct = (bps: number): Rate => (s) => Math.round((s * bps) / 10_000);

export const RATES: Record<Category, Rate> = {
  air_travel: pct(300), // "3% of fare"
  fast_fashion: pct(200), // "2% of item price"
  food_delivery: () => 100, // "flat $1.00"
  single_use_packaging: pct(100), // "1% of item price"
  // "round up to next dollar": $14.25 → 75¢. An exact dollar rounds up a full $1.00.
  general: (s) => 100 - (s % 100),
};

/** Low confidence → general with a flat 100¢ (see LOW_CONFIDENCE_THRESHOLD). */
export const LOW_CONFIDENCE_DONATION_CENTS = 100;
export const LOW_CONFIDENCE_RATE_RULE = "flat $1.00 (low confidence)";
