/**
 * Turns a classification into a donation: rate table first, then guardrails.
 * Pure function, no I/O. Precedence (agreed in A2):
 *   1. opted_out       category is in prefs.optOutCategories → 0
 *   2. low_confidence  confidence < threshold → general, 100¢ (0 if general is opted out)
 *   3. per_order_max / monthly_cap → min(suggested, perOrderMax, cap − month-to-date).
 *      The binding (smaller) cap is the label; a cap overrides low_confidence's label.
 * maxDonationCents = min(perOrderMax, cap − month-to-date): the bound for user edits.
 * The cause is always DEFAULT_CAUSE[category] (prefs.causes not used yet).
 */
import {
  type Adjustment,
  type Category,
  type CauseId,
  type Preferences,
  DEFAULT_CAUSE,
  LOW_CONFIDENCE_THRESHOLD,
  RATE_RULES,
} from "@/contracts";
import { LOW_CONFIDENCE_DONATION_CENTS, LOW_CONFIDENCE_RATE_RULE, RATES } from "./rates";

export type PricingInput = {
  category: Category;
  confidence: number;
  subtotalCents: number;
  prefs: Pick<Preferences, "optOutCategories" | "monthlyCapCents" | "perOrderMaxCents">;
  /** Sum of this user's ledger entries in the current calendar month. */
  monthToDateCents: number;
};

export type Pricing = {
  category: Category;
  causeId: CauseId;
  suggestedDonationCents: number;
  donationCents: number;
  maxDonationCents: number;
  rateRule: string;
  adjustment: Adjustment | null;
};

export function price({ category, confidence, subtotalCents, prefs, monthToDateCents }: PricingInput): Pricing {
  const optedOut = (c: Category) => prefs.optOutCategories.includes(c);
  const maxDonationCents = editLimit(prefs, monthToDateCents);
  const base = (c: Category) => ({ category: c, causeId: DEFAULT_CAUSE[c], maxDonationCents });

  if (optedOut(category)) {
    return {
      ...base(category),
      suggestedDonationCents: RATES[category](subtotalCents),
      donationCents: 0,
      rateRule: RATE_RULES[category],
      adjustment: "opted_out",
    };
  }

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    const suggested = LOW_CONFIDENCE_DONATION_CENTS;
    const capped = applyCaps(optedOut("general") ? 0 : suggested, prefs, monthToDateCents);
    return {
      ...base("general"),
      suggestedDonationCents: suggested,
      donationCents: capped.cents,
      rateRule: LOW_CONFIDENCE_RATE_RULE,
      adjustment: capped.adjustment ?? "low_confidence",
    };
  }

  const suggested = RATES[category](subtotalCents);
  const capped = applyCaps(suggested, prefs, monthToDateCents);
  return {
    ...base(category),
    suggestedDonationCents: suggested,
    donationCents: capped.cents,
    rateRule: RATE_RULES[category],
    adjustment: capped.adjustment,
  };
}

function monthlyRemaining(prefs: PricingInput["prefs"], monthToDateCents: number): number {
  return Math.max(0, prefs.monthlyCapCents - monthToDateCents);
}

function editLimit(prefs: PricingInput["prefs"], monthToDateCents: number): number {
  return Math.min(prefs.perOrderMaxCents, monthlyRemaining(prefs, monthToDateCents));
}

function applyCaps(
  cents: number,
  prefs: PricingInput["prefs"],
  monthToDateCents: number,
): { cents: number; adjustment: "per_order_max" | "monthly_cap" | null } {
  const limit = editLimit(prefs, monthToDateCents);
  if (cents <= limit) return { cents, adjustment: null };
  return {
    cents: limit,
    adjustment: monthlyRemaining(prefs, monthToDateCents) < prefs.perOrderMaxCents ? "monthly_cap" : "per_order_max",
  };
}
