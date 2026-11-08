// Preferences page logic (H5). Pure functions so they're unit-testable.
import type { Preferences, SavePreferencesRequest } from "@/contracts";
import { parseDollars } from "@/lib/donation";

export type Draft = SavePreferencesRequest;

export function toDraft(p: Preferences): Draft {
  const { rawText, causes, optOutCategories, monthlyCapCents, perOrderMaxCents } = p;
  return { rawText, causes, optOutCategories, monthlyCapCents, perOrderMaxCents };
}

/** Adds the value if missing, removes it if present. Keeps the original order. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export type CapText = { monthly: string; perOrder: string };
export type DraftErrors = Partial<Record<"monthly" | "perOrder" | "causes", string>>;

/** Applies the cap inputs to the draft. Returns errors instead when anything is invalid. */
export function finalizeDraft(draft: Draft, caps: CapText): { ok: true; draft: Draft } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const monthly = parseDollars(caps.monthly);
  const perOrder = parseDollars(caps.perOrder);
  if (monthly === null) errors.monthly = "Enter an amount like 15.00";
  if (perOrder === null) errors.perOrder = "Enter an amount like 5.00";
  if (monthly !== null && perOrder !== null && perOrder > monthly) {
    errors.perOrder = "Can't be more than the monthly cap";
  }
  if (draft.causes.length === 0) errors.causes = "Pick at least one cause";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, draft: { ...draft, monthlyCapCents: monthly!, perOrderMaxCents: perOrder! } };
}
