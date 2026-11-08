/**
 * classify(): cart → ClassifyResponse (A2). The LLM picks the category; pricing.ts
 * computes every cent. Catalog prices, preferences and month-to-date giving come from
 * ClassifyStore, which reads the mock store today and Jay's Prisma tables once J2 lands.
 * A3 adds the rules fallback + cache around this function.
 */
import { getPrisma } from "@/lib/db";
import { hashCart } from "@/lib/checkout/cart-hash";
import { ClassifyResponse, type ClassifyRequest, type Preferences } from "@/contracts";
import { mockCatalog, mockCauses } from "@/lib/mocks";
import { nextId, store } from "@/lib/mock-store";
import { anthropicClassifier, type LlmClassifier } from "./llm";
import { price } from "./pricing";

export { LlmError, type LlmErrorKind } from "./llm";

export type ClassifyStore = {
  /** Authoritative unit price for a catalog product; undefined if the product is unknown. */
  getUnitPriceCents(productId: string): Promise<number | undefined>;
  getPreferences(userId: string): Promise<Preferences>;
  /** Sum of the user's ledger entries in the current UTC calendar month. */
  getMonthToDateCents(userId: string, now: Date): Promise<number>;
  newClassificationId(): string;
  save(result: ClassifyResponse): Promise<void>;
};

export type ClassifyDeps = { llm: LlmClassifier; store: ClassifyStore; now?: () => Date };

export async function classify(cart: ClassifyRequest, deps: ClassifyDeps): Promise<ClassifyResponse> {
  const now = deps.now?.() ?? new Date();
  // Never trust client prices: known products are re-priced from the catalog before the
  // LLM sees the cart or any cent is computed. Unknown products keep the client price
  // (create-order rejects them, and eval carts use made-up products).
  const catalogPrices = await Promise.all(cart.items.map((i) => deps.store.getUnitPriceCents(i.productId)));
  const items = cart.items.map((i, n) => ({ ...i, unitPriceCents: catalogPrices[n] ?? i.unitPriceCents }));
  const subtotalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const trusted: ClassifyRequest = { ...cart, items, subtotalCents };

  const [llm, prefs, monthToDateCents] = await Promise.all([
    deps.llm(trusted),
    deps.store.getPreferences(cart.userId),
    deps.store.getMonthToDateCents(cart.userId, now),
  ]);

  const priced = price({ category: llm.category, confidence: llm.confidence, subtotalCents, prefs, monthToDateCents });

  const result = ClassifyResponse.parse({
    classificationId: deps.store.newClassificationId(),
    ...priced,
    confidence: llm.confidence,
    causeName: mockCauses.find((c) => c.id === priced.causeId)?.name ?? priced.causeId,
    reason: llm.reason,
    source: "llm",
  });
await deps.store.save(result);

// Save the classification in Neon for J3 Sandbox checkout.
if (process.env.PAYPAL_MODE === "sandbox") {
  const prisma = getPrisma();

  // Use the server-verified prices calculated earlier.
  const cartHash = hashCart(
    items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      priceCents: item.unitPriceCents,
    })),
  );

  await prisma.classificationApproval.create({
    data: {
      id: result.classificationId,
      userId: cart.userId,
      cartId: cart.cartId,
      cartHash,
      category: result.category,
      causeId: result.causeId,
      suggestedDonationCents: result.suggestedDonationCents,
      donationCents: result.donationCents,
      source: result.source,
    },
  });
}

return result;
}

const catalogPrice = new Map(mockCatalog.products.map((p) => [p.id, p.priceCents]));

/** Mock-store implementation (in-memory, demo-user only). */
export const mockClassifyStore: ClassifyStore = {
  getUnitPriceCents: async (productId) => catalogPrice.get(productId),
  getPreferences: async () => store().preferences,
  getMonthToDateCents: async (userId, now) => {
    const month = now.toISOString().slice(0, 7); // "2026-11"
    return store()
      .ledger.filter((e) => e.userId === userId && e.createdAt.startsWith(month))
      .reduce((s, e) => s + e.amountCents, 0);
  },
  newClassificationId: () => nextId("cls_"),
  save: async (r) => void store().classifications.set(r.classificationId, r),
};

let liveLlm: LlmClassifier | undefined;

/** One Anthropic client per server process. */
export function liveDeps(): ClassifyDeps {
  liveLlm ??= anthropicClassifier();
  return { llm: liveLlm, store: mockClassifyStore };
}
