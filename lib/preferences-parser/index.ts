/**
 * parsePreferences() (A4): plain text → Preferences. Does NOT save; PUT /api/preferences does.
 *
 *   1. Extract causes, opt-outs and stated limits: the LLM in live mode, else the rules parser.
 *      Any LlmError, or a spent LLM budget, falls back to rules, so parsing never fails.
 *   2. caps.ts turns the stated limits into caps, always erring low (defaults, low end of
 *      ranges, period conversion, ceilings, per-order ≤ monthly).
 *   3. No cause found → DEFAULT_CAUSES, since the preferences page can't save an empty list.
 *
 * Where the extraction came from ("llm" | "rules") goes to the server log only; the
 * Preferences contract has no field for it.
 */
import { Preferences } from "@/contracts";
import { LlmError } from "@/lib/classifier/llm";
import { takeGlobalLlmBudget } from "@/lib/classifier";
import { slidingWindowLimiter, type RateLimiter } from "@/lib/rate-limit";
import { DEFAULT_CAUSES, type Extracted, resolveCaps } from "./caps";
import { anthropicPreferencesExtractor, type PreferencesExtractor } from "./llm";
import { rulesExtract } from "./rules";

export { CAP_CEILINGS, DEFAULT_CAPS, DEFAULT_CAUSES } from "./caps";

export type ParseSource = "llm" | "rules";

export type ParseDeps = {
  /** Omit to parse with rules only (LLM_MODE=rules). */
  llm?: PreferencesExtractor;
  /** Called right before the LLM call. false → rules instead. */
  allowLlm?: () => boolean;
  userId: string;
  now?: () => Date;
};

export async function extract(rawText: string, deps: Pick<ParseDeps, "llm" | "allowLlm">): Promise<{ extracted: Extracted; source: ParseSource }> {
  const rules = () => ({ extracted: rulesExtract(rawText), source: "rules" as const });
  if (!deps.llm) return rules();

  if (deps.allowLlm && !deps.allowLlm()) {
    console.warn("[prefs] LLM budget spent (per-IP or global) → rules fallback");
    return rules();
  }
  try {
    return { extracted: await deps.llm(rawText), source: "llm" };
  } catch (err) {
    if (!(err instanceof LlmError)) throw err; // a bug, not an LLM failure
    console.error(`[prefs] ${err.kind}: ${err.message} → rules fallback`);
    return rules();
  }
}

/** Extracted → contract-valid Preferences, with every default and ceiling applied. */
export function toPreferences(rawText: string, e: Extracted, userId: string, now: Date): Preferences {
  return Preferences.parse({
    userId,
    rawText,
    causes: e.causes.length ? e.causes : DEFAULT_CAUSES,
    optOutCategories: e.optOutCategories,
    ...resolveCaps(e),
    updatedAt: now.toISOString(),
  });
}

export async function parsePreferences(
  rawText: string,
  deps: ParseDeps,
): Promise<{ preferences: Preferences; source: ParseSource }> {
  const { extracted, source } = await extract(rawText, deps);
  console.info(`[prefs] parsed via ${source}`);
  return { preferences: toPreferences(rawText, extracted, deps.userId, deps.now?.() ?? new Date()), source };
}

// ---------- live guardrails ----------

/** Same per-IP rate as /api/classify; the 1,000/day global budget is shared with it. */
export const PREFS_PER_IP_LIMIT = { limit: 20, windowMs: 60_000 };

const g = globalThis as unknown as { __offsetPrefsPerIp?: RateLimiter };
const perIp = () => (g.__offsetPrefsPerIp ??= slidingWindowLimiter(PREFS_PER_IP_LIMIT));

/** For tests: reset the per-IP limit (resetClassifyGuards() resets the shared global one). */
export function resetPreferencesGuards(): void {
  g.__offsetPrefsPerIp = undefined;
}

let liveLlm: PreferencesExtractor | undefined;

/** LLM_MODE=live. One Anthropic client per server process. */
export function livePreferencesDeps(ip: string, userId: string): ParseDeps {
  liveLlm ??= anthropicPreferencesExtractor();
  return { llm: liveLlm, allowLlm: () => perIp().take(ip) && takeGlobalLlmBudget(), userId };
}
