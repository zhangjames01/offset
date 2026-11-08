/**
 * Rules classifier (A3): keyword matching, no network. Returns the same
 * {category, confidence, reason} the LLM does, so pricing.ts treats both alike.
 * Used when LLM_MODE=rules, when the LLM fails (any LlmError), and when the
 * per-IP / global LLM budget is spent. Never throws.
 *
 * How it decides:
 *   1. Each line is matched against the keyword rules below (first rule wins per line).
 *   2. The category with the most matched dollars wins (ties: rule order).
 *   3. No category matched → "general". If ambiguous lines (gift cards…) make up at
 *      least half the cart, confidence drops below the low-confidence threshold.
 */
import type { CartItem, Category, ClassifyRequest, LlmClassification } from "@/contracts";

type Rule = { category: Exclude<Category, "general">; label: string; test: (text: string, raw: string) => boolean };

const any = (...res: RegExp[]) => (text: string) => res.some((r) => r.test(text));

const FOOD = /\b(ramen|pizza|sushi|burgers?|tacos?|burritos?|noodles|curry|meals?|bowls?|dinner|lunch|breakfast|food|groceries)\b/;
const DELIVERED = /\b(deliver(y|ed)?|courier)\b/;

/** Order matters: it breaks ties and picks the rule per line. */
export const RULES: Rule[] = [
  {
    category: "air_travel",
    label: "air travel",
    test: (text, raw) =>
      any(/\bflights?\b/, /\bair ?fare\b/, /\bairlines?\b/, /\bplane tickets?\b/, /\b(first|business) class\b/)(text) ||
      /\b[A-Z]{3} ?(→|->|to) ?[A-Z]{3}\b/.test(raw), // airport codes, e.g. "JFK → LAX"
  },
  {
    category: "fast_fashion",
    label: "fast fashion",
    test: any(
      /\bfast[- ]fashion\b/,
      /\b(t-?shirts?|tees?|tank tops?|crop tops?|hoodies?|sweaters?|dress(es)?|jeans|leggings|apparel|clothing|blouses?)\b/,
    ),
  },
  {
    category: "food_delivery",
    label: "food delivery",
    test: (text) =>
      /\b(food delivery|takeout|take-out|doordash|uber ?eats|grubhub)\b/.test(text) ||
      (DELIVERED.test(text) && FOOD.test(text)),
  },
  {
    category: "single_use_packaging",
    label: "single-use packaging",
    test: any(
      /\bindividually[- ]wrapped\b/,
      /\bsingle[- ](use|serve|serving)\b/,
      /\bdisposable\b/,
      /\b(k-?cups?|coffee pods)\b/,
      /\bbottled water\b/,
      /\bplastic (cutlery|utensils|cups|straws|bags)\b/,
      /\bmulti-?packs?\b/,
    ),
  },
];

/** Spend-anywhere items: no footprint can be inferred, so confidence is low. */
const AMBIGUOUS = /\b(gift ?cards?|gift certificates?|vouchers?|store credit|prepaid cards?)\b/;

export const RULES_CONFIDENCE = {
  /** The winning category is at least half the cart's dollars. */
  dominant: 0.75,
  /** A category matched but covers less than half the cart. */
  partial: 0.6,
  /** Nothing matched: plain "general" (round up). */
  general: 0.7,
  /** Mostly gift cards and the like: below LOW_CONFIDENCE_THRESHOLD on purpose. */
  ambiguous: 0.4,
} as const;

const lineText = (i: CartItem) => `${i.name} ${i.description}`;
const lineTotal = (i: CartItem) => i.unitPriceCents * i.quantity;

export function rulesClassify(cart: Pick<ClassifyRequest, "items">): LlmClassification {
  const subtotal = cart.items.reduce((s, i) => s + lineTotal(i), 0);
  const dollars = new Map<Rule, number>();
  const firstMatch = new Map<Rule, CartItem>();
  let ambiguousCents = 0;

  for (const item of cart.items) {
    const raw = lineText(item);
    const text = raw.toLowerCase();
    const rule = RULES.find((r) => r.test(text, raw));
    if (rule) {
      dollars.set(rule, (dollars.get(rule) ?? 0) + lineTotal(item));
      if (!firstMatch.has(rule)) firstMatch.set(rule, item);
    } else if (AMBIGUOUS.test(text)) {
      ambiguousCents += lineTotal(item);
    }
  }

  // Highest matched dollars wins; RULES order breaks ties (Map keeps insertion order,
  // so sort a copy of RULES instead).
  const winner = RULES.filter((r) => dollars.has(r)).sort((a, b) => dollars.get(b)! - dollars.get(a)!)[0];

  if (winner) {
    const share = subtotal > 0 ? dollars.get(winner)! / subtotal : 1;
    const item = firstMatch.get(winner)!;
    return {
      category: winner.category,
      confidence: share >= 0.5 ? RULES_CONFIDENCE.dominant : RULES_CONFIDENCE.partial,
      reason: `“${clip(item.name)}” looks like ${winner.label}, so it's matched to that cause.`,
    };
  }

  if (subtotal > 0 && ambiguousCents * 2 >= subtotal) {
    return {
      category: "general",
      confidence: RULES_CONFIDENCE.ambiguous,
      reason: "Gift cards can be spent on anything, so this uses a small general donation.",
    };
  }

  return {
    category: "general",
    confidence: RULES_CONFIDENCE.general,
    reason: "No specific footprint stands out in this cart, so this rounds up to the general fund.",
  };
}

function clip(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
