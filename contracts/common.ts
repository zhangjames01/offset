/**
 * Shared primitives and enums. Single source of truth — see the build plan's
 * "Interface contracts" section. Changing anything in contracts/ needs a PR
 * approved by the other two teammates.
 */
import { z } from "zod";

/** Money is ALWAYS integer cents. Convert to PayPal "12.34" strings only at the PayPal boundary. */
export const Cents = z.int().nonnegative();
export type Cents = z.infer<typeof Cents>;

export const Currency = z.literal("USD");

export const IsoDateTime = z.iso.datetime();

export const Category = z.enum([
  "air_travel",
  "fast_fashion",
  "food_delivery",
  "single_use_packaging",
  "general",
]);
export type Category = z.infer<typeof Category>;

export const UserAction = z.enum(["accepted", "edited", "removed"]);
export type UserAction = z.infer<typeof UserAction>;

export const CauseId = z.enum([
  "carbon_removal",
  "textile_recycling",
  "food_bank",
  "ocean_plastic",
  "general_fund",
]);
export type CauseId = z.infer<typeof CauseId>;

/** Placeholder rates (code, never the LLM). Tune in lib/classifier/rates.ts. */
export const RATE_RULES: Record<Category, string> = {
  air_travel: "3% of fare",
  fast_fashion: "2% of item price",
  food_delivery: "flat $1.00",
  single_use_packaging: "1% of item price",
  general: "round up to next dollar",
};

/** Default cause for each category (placeholder partners). */
export const DEFAULT_CAUSE: Record<Category, CauseId> = {
  air_travel: "carbon_removal",
  fast_fashion: "textile_recycling",
  food_delivery: "food_bank",
  single_use_packaging: "ocean_plastic",
  general: "general_fund",
};

/** Below this confidence the classifier falls back to `general` with a 100¢ donation. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
