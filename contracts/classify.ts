import { z } from "zod";
import { Category, CauseId, Cents, Currency } from "./common";

export const CartItem = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  unitPriceCents: Cents,
  quantity: z.int().positive(),
});
export type CartItem = z.infer<typeof CartItem>;

/**
 * POST /api/classify body, built by the frontend from the cart.
 * The server loads preferences and month-to-date giving itself; the client never sends caps.
 */
export const ClassifyRequest = z.object({
  cartId: z.string().min(1),
  currency: Currency,
  items: z.array(CartItem).min(1),
  subtotalCents: Cents,
  userId: z.string().min(1),
});
export type ClassifyRequest = z.infer<typeof ClassifyRequest>;

export const Adjustment = z.enum([
  "per_order_max",
  "monthly_cap",
  "opted_out", // donation 0
  "low_confidence", // category becomes general with a 100¢ donation (0 if general is opted out)
]);
export type Adjustment = z.infer<typeof Adjustment>;

export const ClassificationSource = z.enum(["llm", "rules", "cache"]);
export type ClassificationSource = z.infer<typeof ClassificationSource>;

/** The ONLY thing the LLM returns. Invalid output → source becomes "rules". */
export const LlmClassification = z.object({
  category: Category,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(300),
});
export type LlmClassification = z.infer<typeof LlmClassification>;

export const ClassifyResponse = z.object({
  classificationId: z.string().min(1),
  category: Category,
  confidence: z.number().min(0).max(1),
  causeId: CauseId,
  causeName: z.string().min(1),
  /** Amount from the rate table, before caps. */
  suggestedDonationCents: Cents,
  /** Amount after caps / opt-outs / low-confidence rules. */
  donationCents: Cents,
  rateRule: z.string().min(1),
  reason: z.string().min(1),
  adjustment: Adjustment.nullable(),
  source: ClassificationSource,
});
export type ClassifyResponse = z.infer<typeof ClassifyResponse>;
