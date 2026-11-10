/**
 * classify(): cart → ClassifyResponse. The classifier picks the category; pricing.ts
 * computes every cent. Catalog prices, preferences and month-to-date giving come from
 * ClassifyStore, which reads the mock store today and Jay's Prisma tables once J2 lands.
 *
 * Where the category comes from (A3), recorded in `source`:
 *   "cache"  same cart classified by the LLM recently (pricing still re-runs)
 *   "llm"    live call; the result is cached
 *   "rules"  keyword classifier: LLM_MODE=rules, any LlmError, or LLM budget spent
 */
import { getPrisma } from "@/lib/db";
import { hashCart } from "@/lib/checkout/cart-hash";
import {
  ClassifyResponse,
  Preferences,
  type ClassificationSource,
  type ClassifyRequest,
  type LlmClassification,
} from "@/contracts";
import { mockCatalog, mockCauses } from "@/lib/mocks";
import { store } from "@/lib/mock-store";
import { slidingWindowLimiter, type RateLimiter } from "@/lib/rate-limit";
import { type ClassificationCache, cartKey, memoryCache } from "./cache";
import { LlmError, anthropicClassifier, type LlmClassifier } from "./llm";
import { price } from "./pricing";
import { rulesClassify } from "./rules";
import { randomUUID } from "node:crypto";

export { LlmError, type LlmErrorKind } from "./llm";

export type ClassifyStore = {
  getUnitPriceCents(productId: string): Promise<number | undefined>;
  getPreferences(userId: string): Promise<Preferences>;
  getMonthToDateCents(userId: string, now: Date): Promise<number>;
  newClassificationId(): string;

  save(
    result: ClassifyResponse,
    context: {
      userId: string;
      cartId: string;
      cartHash: string;
    },
  ): Promise<void>;
};

export type ClassifyDeps = {
  /** Omit to classify with rules only (LLM_MODE=rules). */
  llm?: LlmClassifier;
  store: ClassifyStore;
  now?: () => Date;
  /** LLM results are read from and written to this cache. */
  cache?: ClassificationCache;
  /** Called only on a cache miss, right before the LLM call. false → rules instead. */
  allowLlm?: () => boolean;
};

export async function classify(cart: ClassifyRequest, deps: ClassifyDeps): Promise<ClassifyResponse> {
  const now = deps.now?.() ?? new Date();
  // Never trust client prices: known products are re-priced from the catalog before the
  // LLM sees the cart or any cent is computed. Unknown products keep the client price
  // (create-order rejects them, and eval carts use made-up products).
  const catalogPrices = await Promise.all(cart.items.map((i) => deps.store.getUnitPriceCents(i.productId)));
  const items = cart.items.map((i, n) => ({ ...i, unitPriceCents: catalogPrices[n] ?? i.unitPriceCents }));
  const subtotalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const trusted: ClassifyRequest = { ...cart, items, subtotalCents };

  const [label, prefs, monthToDateCents] = await Promise.all([
    categorize(trusted, deps),
    deps.store.getPreferences(cart.userId),
    deps.store.getMonthToDateCents(cart.userId, now),
  ]);

  const priced = price({ category: label.category, confidence: label.confidence, subtotalCents, prefs, monthToDateCents });

  const result = ClassifyResponse.parse({
    classificationId: deps.store.newClassificationId(),
    ...priced,
    confidence: label.confidence,
    causeName: mockCauses.find((c) => c.id === priced.causeId)?.name ?? priced.causeId,
    reason: label.reason,
    source: label.source,
  });
await deps.store.save(result, {
  userId: cart.userId,
  cartId: cart.cartId,
  cartHash: hashCart(
    items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      priceCents: item.unitPriceCents,
    })),
  ),
});

return result;
}

type Label = LlmClassification & { source: ClassificationSource };

async function categorize(cart: ClassifyRequest, deps: ClassifyDeps): Promise<Label> {
  const rules = (): Label => ({ ...rulesClassify(cart), source: "rules" });
  if (!deps.llm) return rules();

  const key = cartKey(cart);
  const cached = deps.cache?.get(key);
  if (cached) return { ...cached, source: "cache" };

  if (deps.allowLlm && !deps.allowLlm()) {
    console.warn("[classify] LLM budget spent (per-IP or global) → rules fallback");
    return rules();
  }

  try {
    const llm = await deps.llm(cart);
    deps.cache?.set(key, llm);
    return { ...llm, source: "llm" };
  } catch (err) {
    if (!(err instanceof LlmError)) throw err; // a bug, not an LLM failure
    // Details stay in the server log; the client just sees source: "rules".
    console.error(`[classify] ${err.kind}: ${err.message} → rules fallback`);
    return rules();
  }
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
  newClassificationId: () => `cls_${randomUUID()}`,
  save: async (r) => void store().classifications.set(r.classificationId, r),
};

export const prismaClassifyStore: ClassifyStore = {
  getUnitPriceCents: async (productId) =>
    catalogPrice.get(productId),

  getPreferences: async (userId) => {
    const saved = await getPrisma().preferences.findUnique({
      where: { userId },
    });

    if (!saved) {
      throw new Error("Demo preferences not seeded in Neon");
    }

    return Preferences.parse({
      ...saved,
      updatedAt: saved.updatedAt.toISOString(),
    });
  },

  getMonthToDateCents: async (userId, now) => {
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const giving = await getPrisma().ledgerEntry.aggregate({
      where: {
        userId,
        createdAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    });

    return giving._sum.amountCents ?? 0;
  },

  newClassificationId: () => `cls_${randomUUID()}`,

  save: async (result, context) => {
    await getPrisma().classificationApproval.create({
      data: {
        id: result.classificationId,
        userId: context.userId,
        cartId: context.cartId,
        cartHash: context.cartHash,
        category: result.category,
        causeId: result.causeId,
        suggestedDonationCents: result.suggestedDonationCents,
        donationCents: result.donationCents,
        source: result.source,
      },
    });
  },
};

// ---------- live guardrails (A3) ----------

/** ~20 LLM calls per IP per minute (cache hits don't count). */
export const PER_IP_LIMIT = { limit: 20, windowMs: 60_000 };
/** Global cap across all IPs, since X-Forwarded-For can be spoofed (worst case ≈ $0.25/day). */
export const GLOBAL_LIMIT = { limit: 1_000, windowMs: 24 * 60 * 60 * 1000 };

type Guards = { cache: ClassificationCache; perIp: RateLimiter; global: RateLimiter };

// globalThis keeps one cache across route modules and dev hot reloads (like the mock store).
const g = globalThis as unknown as { __offsetClassifyGuards?: Guards };

function guards(): Guards {
  g.__offsetClassifyGuards ??= {
    cache: memoryCache(),
    perIp: slidingWindowLimiter(PER_IP_LIMIT),
    global: slidingWindowLimiter(GLOBAL_LIMIT),
  };
  return g.__offsetClassifyGuards;
}

/** Spends one call from the global daily LLM budget. The preferences parser (A4) shares it. */
export function takeGlobalLlmBudget(): boolean {
  return guards().global.take("all");
}

/** For tests: empty the cache and reset the rate limits. */
export function resetClassifyGuards(): void {
  g.__offsetClassifyGuards = undefined;
}

let liveLlm: LlmClassifier | undefined;

/** LLM_MODE=live. One Anthropic client per server process. */
export function liveDeps(ip: string): ClassifyDeps {
  liveLlm ??= anthropicClassifier();
  const { cache, perIp, global } = guards();
  return {
    llm: liveLlm,
    store:
      process.env.PAYPAL_MODE === "sandbox"
        ? prismaClassifyStore
        : mockClassifyStore,
    cache,
    allowLlm: () => perIp.take(ip) && global.take("all"),
  };
}

/** LLM_MODE=rules: keyword classifier only, no network. */
export function rulesDeps(): ClassifyDeps {
  return {
    store:
      process.env.PAYPAL_MODE === "sandbox"
        ? prismaClassifyStore
        : mockClassifyStore,
  };
}
