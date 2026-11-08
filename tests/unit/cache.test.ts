// Classification cache + rate limiter (A3).
import { describe, expect, test } from "vitest";
import type { CartItem } from "@/contracts";
import { cartKey, memoryCache } from "@/lib/classifier/cache";
import { clientIp, slidingWindowLimiter } from "@/lib/rate-limit";

const a: CartItem = { productId: "a", name: "A", description: "first", unitPriceCents: 100, quantity: 1 };
const b: CartItem = { productId: "b", name: "B", description: "second", unitPriceCents: 200, quantity: 2 };
const label = { category: "general" as const, confidence: 0.8, reason: "r" };

describe("cartKey", () => {
  test("ignores line order but not content", () => {
    expect(cartKey({ items: [a, b] })).toBe(cartKey({ items: [b, a] }));
    expect(cartKey({ items: [a] })).not.toBe(cartKey({ items: [{ ...a, quantity: 2 }] }));
    expect(cartKey({ items: [a] })).not.toBe(cartKey({ items: [{ ...a, unitPriceCents: 101 }] }));
    expect(cartKey({ items: [a] })).not.toBe(cartKey({ items: [{ ...a, description: "other" }] }));
    expect(cartKey({ items: [a] })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("memoryCache", () => {
  test("hit, then expiry after the TTL", () => {
    let t = 0;
    const cache = memoryCache({ ttlMs: 1000, now: () => t });
    cache.set("k", label);
    t = 999;
    expect(cache.get("k")).toEqual(label);
    t = 1000;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test("evicts the least recently used entry past maxEntries", () => {
    const cache = memoryCache({ maxEntries: 2 });
    cache.set("1", label);
    cache.set("2", label);
    cache.get("1"); // 1 is now more recent than 2
    cache.set("3", label);
    expect(cache.get("2")).toBeUndefined();
    expect(cache.get("1")).toEqual(label);
    expect(cache.get("3")).toEqual(label);
  });

  test("returns copies, so callers can't mutate the cache", () => {
    const cache = memoryCache();
    cache.set("k", label);
    cache.get("k")!.reason = "changed";
    expect(cache.get("k")!.reason).toBe("r");
  });
});

describe("slidingWindowLimiter", () => {
  test("allows `limit` calls per window per key, then frees up as calls age out", () => {
    let t = 0;
    const rl = slidingWindowLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect([rl.take("x"), rl.take("x"), rl.take("x")]).toEqual([true, true, false]);
    expect(rl.take("y")).toBe(true);
    t = 999;
    expect(rl.take("x")).toBe(false);
    t = 1000;
    expect(rl.take("x")).toBe(true); // the t=0 calls left the window
  });

  test("bounds memory by evicting the oldest keys", () => {
    const rl = slidingWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    rl.take("a");
    rl.take("b");
    rl.take("c"); // evicts "a"
    expect(rl.take("a")).toBe(true);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://test", { headers });
  test("first X-Forwarded-For entry, then X-Real-IP, then 'unknown'", () => {
    expect(clientIp(req({ "x-forwarded-for": " 1.2.3.4 , 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
