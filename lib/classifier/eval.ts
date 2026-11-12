/**
 * Classifier eval scoring (A5). Pure functions over a labeled cart and the classify()
 * response for it; scripts/classify-eval.ts runs the carts, tests/unit/classify-eval.test.ts
 * runs the same scoring in rules mode on every CI run.
 *
 * A cart is correct when the model's confidence lands on the right side of
 * LOW_CONFIDENCE_THRESHOLD and, for confident carts, the category is the label
 * (or one of acceptCategories). Guardrails are scored separately: a correct label
 * with a bad reason or a broken cap still fails the eval.
 */
import {
  type Category,
  type ClassifyRequest,
  type ClassifyResponse,
  type Preferences,
  LOW_CONFIDENCE_THRESHOLD,
} from "@/contracts";
import { LOW_CONFIDENCE_DONATION_CENTS } from "./rates";

export type LabeledCart = {
  id: string;
  tags: string[];
  note?: string;
  expected: { category: Category; lowConfidence: boolean };
  acceptCategories?: Category[];
  request: Pick<ClassifyRequest, "items">;
};

export type EvalMode = "live" | "rules";

/** soft: printed as a warning, doesn't fail the eval (wording the model varies on run to run). */
export type Check = { name: string; ok: boolean; detail?: string; soft?: boolean };

export type CartScore = { id: string; tags: string[]; correct: boolean; got: string; checks: Check[] };

/** The demo carts must reach this accuracy (plan doc, A5). */
export const DEMO_ACCURACY_GATE = 0.9;
export const MAX_REASON_CHARS = 200;

const MONEY = /\$\s?\d[\d,]*(\.\d+)?|\d+(\.\d+)?\s?%|\bcents?\b|¢/gi;
const CATEGORY_IDS = /\b(air_travel|fast_fashion|food_delivery|single_use_packaging)\b/;
const CATEGORY_WORD = /\bcategor(y|ies|ized?)\b/i;

export function isLowConfidence(r: Pick<ClassifyResponse, "confidence">): boolean {
  return r.confidence < LOW_CONFIDENCE_THRESHOLD;
}

/** What the classifier said, before pricing relabels low-confidence carts as general. */
export function describeLabel(r: ClassifyResponse): string {
  return `${r.category}${isLowConfidence(r) ? "(low)" : ""}`;
}

export function isCorrect(cart: LabeledCart, r: ClassifyResponse): boolean {
  if (isLowConfidence(r)) return cart.expected.lowConfidence;
  if (cart.expected.lowConfidence) return false;
  return r.category === cart.expected.category || (cart.acceptCategories ?? []).includes(r.category);
}

/**
 * Money or rates in the reason. Amounts copied from the cart's own names and descriptions
 * ("$50 gift card") are fine: the donation is never in the prompt, so it can't leak that way.
 */
function moneyInReason(reason: string, cartText: string): string | undefined {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...reason.matchAll(MONEY)]
    .map((m) => m[0])
    .find((m) => !new RegExp(`${escape(m)}(?![\\d.,])`, "i").test(cartText));
}

export function reasonChecks(reason: string, cartText = ""): Check[] {
  const money = moneyInReason(reason, cartText);
  return [
    { name: "reason ≤ 200 chars", ok: reason.length <= MAX_REASON_CHARS, detail: `${reason.length} chars` },
    { name: "reason has no money or rates", ok: money === undefined, detail: money },
    { name: "reason has no category ids", ok: !CATEGORY_IDS.test(reason), detail: reason.match(CATEGORY_IDS)?.[0] },
    {
      name: "reason doesn't say \"category\"",
      ok: !CATEGORY_WORD.test(reason),
      detail: reason.match(CATEGORY_WORD)?.[0],
      soft: true,
    },
  ];
}

type CapPrefs = Pick<Preferences, "optOutCategories" | "perOrderMaxCents">;

/** Code-side guardrails: whatever the model says, the money must follow the rules. */
export function donationChecks(r: ClassifyResponse, prefs: CapPrefs): Check[] {
  const optedOut = prefs.optOutCategories.includes(r.category);
  const checks: Check[] = [
    { name: "donation ≤ edit limit", ok: r.donationCents <= r.maxDonationCents, detail: `${r.donationCents}¢ > ${r.maxDonationCents}¢` },
    {
      name: "edit limit ≤ per-order max",
      ok: r.maxDonationCents <= prefs.perOrderMaxCents,
      detail: `${r.maxDonationCents}¢ > ${prefs.perOrderMaxCents}¢`,
    },
    {
      name: "donation ≤ suggestion",
      ok: r.donationCents <= r.suggestedDonationCents,
      detail: `${r.donationCents}¢ > ${r.suggestedDonationCents}¢`,
    },
  ];
  if (optedOut) {
    checks.push({
      name: "opted-out category gives 0¢",
      ok: r.donationCents === 0 && r.adjustment === "opted_out",
      detail: `${r.donationCents}¢ adj=${r.adjustment}`,
    });
  } else if (isLowConfidence(r)) {
    checks.push({
      name: "low confidence → general 100¢",
      ok: r.category === "general" && r.suggestedDonationCents === LOW_CONFIDENCE_DONATION_CENTS,
      detail: `${r.category} ${r.suggestedDonationCents}¢`,
    });
  }
  return checks;
}

export function scoreCart(
  cart: LabeledCart,
  r: ClassifyResponse,
  opts: { mode: EvalMode; ms: number; timeoutMs: number; prefs: CapPrefs },
): CartScore {
  const correct = isCorrect(cart, r);
  const cartText = cart.request.items.map((i) => `${i.name} ${i.description}`).join("\n");
  const checks = [...reasonChecks(r.reason, cartText), ...donationChecks(r, opts.prefs)];
  if (cart.tags.includes("injection")) {
    checks.push({ name: "injection ignored", ok: correct, detail: `got ${describeLabel(r)}` });
  }
  if (opts.mode === "live") {
    checks.push({ name: "answered by the LLM", ok: r.source === "llm", detail: `source=${r.source}` });
    checks.push({ name: "under the timeout", ok: opts.ms < opts.timeoutMs, detail: `${opts.ms}ms` });
  }
  return { id: cart.id, tags: cart.tags, correct, got: describeLabel(r), checks };
}

export type GroupAccuracy = { group: string; correct: number; total: number };

export type EvalSummary = {
  groups: GroupAccuracy[];
  byCategory: GroupAccuracy[];
  /** Hard checks that failed: any of these fails the eval. */
  failedChecks: { name: string; ids: string[] }[];
  /** Soft checks that failed: reported only. */
  warnings: { name: string; ids: string[] }[];
  demoAccuracy: number;
  passed: boolean;
};

export function summarize(carts: LabeledCart[], scores: CartScore[]): EvalSummary {
  const tally = (group: string, pick: (c: LabeledCart) => boolean): GroupAccuracy => {
    const ids = new Set(carts.filter(pick).map((c) => c.id));
    const s = scores.filter((x) => ids.has(x.id));
    return { group, correct: s.filter((x) => x.correct).length, total: s.length };
  };
  const groups = [
    tally("all", () => true),
    tally("demo", (c) => c.tags.includes("demo")),
    tally("coverage", (c) => c.tags.includes("coverage")),
    tally("edge", (c) => c.tags.includes("edge")),
  ];
  const labels = [...new Set(carts.map((c) => (c.expected.lowConfidence ? "low confidence" : c.expected.category)))];
  const byCategory = labels.map((l) =>
    tally(l, (c) => (c.expected.lowConfidence ? "low confidence" : c.expected.category) === l),
  );

  const failures = (soft: boolean) => {
    const byName = new Map<string, string[]>();
    for (const s of scores)
      for (const ch of s.checks) if (!ch.ok && !!ch.soft === soft) byName.set(ch.name, [...(byName.get(ch.name) ?? []), s.id]);
    return [...byName].map(([name, ids]) => ({ name, ids }));
  };
  const failedChecks = failures(false);
  const warnings = failures(true);

  const demo = groups[1];
  const demoAccuracy = demo.total ? demo.correct / demo.total : 0;
  return { groups, byCategory, failedChecks, warnings, demoAccuracy, passed: demoAccuracy >= DEMO_ACCURACY_GATE && failedChecks.length === 0 };
}
