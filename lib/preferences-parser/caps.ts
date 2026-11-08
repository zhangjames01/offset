/**
 * Cap rules for the preferences parser (A4). Pure functions, no I/O.
 * The LLM (or the rules parser) only reports the amounts it found in the text;
 * this file turns them into monthlyCapCents / perOrderMaxCents, always erring low:
 *
 *   - Nothing usable stated (or vague, like "a few bucks") → DEFAULT_CAPS.
 *   - A range → its low end ("$10–20 a month" → $10).
 *   - Other periods → per month: week × 4, day × 28, year ÷ 12 (rounded down).
 *   - A limit with no period or per-order wording counts as monthly (the lower outcome).
 *   - Clamped to CAP_CEILINGS, and per-order is never more than the monthly cap.
 */
import type { Category, CauseId } from "@/contracts";

export type Period = "month" | "week" | "day" | "year";

/** One stated limit. Amounts are dollars as written; highDollars = lowDollars unless it's a range. */
export type StatedLimit = { lowDollars: number; highDollars: number };

/** What a parser (LLM or rules) extracts from the text. No cents, no defaults applied yet. */
export type Extracted = {
  causes: CauseId[];
  optOutCategories: Category[];
  /** A spending limit over time. null = not stated, or too vague to use. */
  budget: (StatedLimit & { period: Period }) | null;
  /** A limit per order / purchase. null = not stated, or too vague to use. */
  perOrder: StatedLimit | null;
};

export const DEFAULT_CAPS = { monthlyCapCents: 1000, perOrderMaxCents: 500 } as const;
export const CAP_CEILINGS = { monthlyCapCents: 10_000, perOrderMaxCents: 2_500 } as const;
/** Used when the text names no cause: Hua's page can't save an empty list (H5). */
export const DEFAULT_CAUSES: CauseId[] = ["general_fund"];

/** Conservative read of a stated limit: the lower of its two ends, in whole cents. null if unusable. */
function lowCents(limit: StatedLimit): number | null {
  const values = [limit.lowDollars, limit.highDollars].filter((d) => Number.isFinite(d) && d >= 0);
  if (values.length === 0) return null;
  return Math.round(Math.min(...values) * 100);
}

/** Per-month cents for an amount over `period`. Rounds down so the cap never grows. */
export function toMonthlyCents(cents: number, period: Period): number {
  switch (period) {
    case "month":
      return cents;
    case "week":
      return cents * 4;
    case "day":
      return cents * 28;
    case "year":
      return Math.floor(cents / 12);
  }
}

export function resolveCaps(e: Pick<Extracted, "budget" | "perOrder">): {
  monthlyCapCents: number;
  perOrderMaxCents: number;
} {
  const budgetCents = e.budget ? lowCents(e.budget) : null;
  const perOrderCents = e.perOrder ? lowCents(e.perOrder) : null;

  const monthly = Math.min(
    budgetCents === null ? DEFAULT_CAPS.monthlyCapCents : toMonthlyCents(budgetCents, e.budget!.period),
    CAP_CEILINGS.monthlyCapCents,
  );
  const perOrder = Math.min(perOrderCents ?? DEFAULT_CAPS.perOrderMaxCents, CAP_CEILINGS.perOrderMaxCents, monthly);
  return { monthlyCapCents: monthly, perOrderMaxCents: perOrder };
}

/** Dedupes while keeping first-mention order. */
export function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}
