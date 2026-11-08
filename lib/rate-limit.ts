/**
 * Sliding-window rate limiter, in memory (one Render instance). Used by
 * /api/classify (A3) to bound LLM spend: over the limit, the route serves the
 * rules classifier instead of calling the LLM, so callers never see an error.
 */
export type RateLimiter = {
  /** Records one call for `key` and returns true if it is within the limit. */
  take(key: string): boolean;
};

export function slidingWindowLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((ts) => ts > t - windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(t);
      hits.delete(key); // re-insert so the oldest keys are evicted first
      hits.set(key, recent);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
      return allowed;
    },
  };
}

/**
 * Client IP for rate limiting. On Render the first X-Forwarded-For entry is the
 * client. It can be spoofed, which is why /api/classify also has a global budget.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip")?.trim() || "unknown";
}
