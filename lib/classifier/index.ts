/**
 * classify(): cart → ClassifyResponse (A2). The LLM picks the category; pricing.ts
 * computes every cent. Preferences and month-to-date giving come from ClassifyStore,
 * which reads the mock store today and Jay's Prisma tables once J2 lands.
 * A3 adds the rules fallback + cache around this function.
 */
import { ClassifyResponse, type ClassifyRequest, type Preferences } from "@/contracts";
import { mockCauses } from "@/lib/mocks";
import { nextId, store } from "@/lib/mock-store";
import { anthropicClassifier, type LlmClassifier } from "./llm";
import { price } from "./pricing";

export { LlmError, type LlmErrorKind } from "./llm";

export type ClassifyStore = {
  getPreferences(userId: string): Promise<Preferences>;
  /** Sum of the user's ledger entries in the current UTC calendar month. */
  getMonthToDateCents(userId: string, now: Date): Promise<number>;
  newClassificationId(): string;
  save(result: ClassifyResponse): Promise<void>;
};

export type ClassifyDeps = { llm: LlmClassifier; store: ClassifyStore; now?: () => Date };

export async function classify(cart: ClassifyRequest, deps: ClassifyDeps): Promise<ClassifyResponse> {
  const now = deps.now?.() ?? new Date();
  const [llm, prefs, monthToDateCents] = await Promise.all([
    deps.llm(cart),
    deps.store.getPreferences(cart.userId),
    deps.store.getMonthToDateCents(cart.userId, now),
  ]);

  // Price from the line items, not the client's subtotal. create-order re-prices from the catalog.
  const subtotalCents = cart.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
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
  return result;
}

/** Mock-store implementation (in-memory, demo-user only). */
export const mockClassifyStore: ClassifyStore = {
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
