/**
 * Classification cache (A3). Stores only the LLM's {category, confidence, reason},
 * keyed on a hash of the re-priced cart. Preferences are NOT in the key: the LLM
 * never sees them, and pricing re-runs on every request with live prefs and
 * month-to-date, so caps are always current. Rules results are never cached, so a
 * recovered LLM gets used on the next request.
 *
 * In-memory, per server process (one Render instance), LRU with a TTL.
 * A restart empties it; that only costs a few LLM calls.
 */
import { createHash } from "node:crypto";
import type { ClassifyRequest, LlmClassification } from "@/contracts";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 500;

export type ClassificationCache = {
  get(key: string): LlmClassification | undefined;
  set(key: string, value: LlmClassification): void;
  readonly size: number;
};

/**
 * Hash of exactly what the LLM sees: name, description, quantity and trusted price
 * per line. Line order is ignored. Pass the cart AFTER catalog re-pricing.
 */
export function cartKey(cart: Pick<ClassifyRequest, "items">): string {
  const lines = cart.items
    .map((i) => [i.productId, i.name, i.description, i.unitPriceCents, i.quantity] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(lines)).digest("hex");
}

export function memoryCache({
  ttlMs = CACHE_TTL_MS,
  maxEntries = CACHE_MAX_ENTRIES,
  now = Date.now,
}: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): ClassificationCache {
  const entries = new Map<string, { value: LlmClassification; expires: number }>();

  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      entries.delete(key);
      if (hit.expires <= now()) return undefined;
      entries.set(key, hit); // most recently used goes last
      return structuredClone(hit.value);
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value: structuredClone(value), expires: now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    get size() {
      return entries.size;
    },
  };
}
