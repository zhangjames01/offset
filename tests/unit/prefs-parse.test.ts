// parsePreferences() + POST /api/preferences/parse in LLM_MODE=live / rules / mock (A4), with a fake LLM. No network.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Preferences } from "@/contracts";
import { GLOBAL_LIMIT, resetClassifyGuards } from "@/lib/classifier";
import { LlmError } from "@/lib/classifier/llm";
import type { Extracted } from "@/lib/preferences-parser/caps";
import { mockPreferences } from "@/lib/mocks";
import { resetStore, store } from "@/lib/mock-store";

// The route builds its extractor via anthropicPreferencesExtractor(); swap in a controllable fake.
let fakeLlm: (rawText: string) => Promise<Extracted>;
vi.mock("@/lib/preferences-parser/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/preferences-parser/llm")>()),
  anthropicPreferencesExtractor: () => (rawText: string) => fakeLlm(rawText),
}));
import { parsePreferences, resetPreferencesGuards } from "@/lib/preferences-parser";
import { POST } from "@/app/api/preferences/parse/route";

const DEMO = "I care about climate and hunger. Max $15 a month, skip packaging.";
/** What a good LLM answer for "…ocean… $5 a week" looks like (differs from what rules would give). */
const llmAnswer: Extracted = {
  causes: ["ocean_plastic"],
  optOutCategories: ["fast_fashion"],
  budget: { lowDollars: 5, highDollars: 5, period: "week" },
  perOrder: { lowDollars: 2, highDollars: 2 },
};

const post = (body: unknown, ip = "1.1.1.1") =>
  POST(
    new Request("http://test/api/preferences/parse", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
const parsed = async (res: Response) => {
  expect(res.status).toBe(200);
  return Preferences.parse(await res.json());
};

beforeEach(() => {
  resetStore();
  resetClassifyGuards();
  resetPreferencesGuards();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parsePreferences()", () => {
  const NOW = () => new Date("2026-11-07T12:00:00Z");

  test("LLM path: caps are applied by code (week × 4), source llm", async () => {
    const r = await parsePreferences("anything", { llm: async () => llmAnswer, userId: "u1", now: NOW });
    expect(r.source).toBe("llm");
    expect(r.preferences).toEqual({
      userId: "u1",
      rawText: "anything",
      causes: ["ocean_plastic"],
      optOutCategories: ["fast_fashion"],
      monthlyCapCents: 2000,
      perOrderMaxCents: 200,
      updatedAt: "2026-11-07T12:00:00.000Z",
    });
  });

  test("an LLM asking for huge caps is clamped to the ceilings", async () => {
    const greedy: Extracted = { ...llmAnswer, budget: { lowDollars: 1e6, highDollars: 1e6, period: "month" }, perOrder: { lowDollars: 1e6, highDollars: 1e6 } };
    const r = await parsePreferences("x", { llm: async () => greedy, userId: "u1" });
    expect([r.preferences.monthlyCapCents, r.preferences.perOrderMaxCents]).toEqual([10_000, 2_500]);
  });

  test("no cause found → general_fund (the preferences page can't save an empty list)", async () => {
    const r = await parsePreferences("x", { llm: async () => ({ ...llmAnswer, causes: [] }), userId: "u1" });
    expect(r.preferences.causes).toEqual(["general_fund"]);
  });

  test.each(["invalid_output", "timeout", "rate_limited", "api_error", "not_configured"] as const)(
    "LlmError %s → rules fallback, details logged only",
    async (kind) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await parsePreferences(DEMO, {
        llm: async () => {
          throw new LlmError(kind, "secret detail");
        },
        userId: "u1",
      });
      expect(r.source).toBe("rules");
      expect(r.preferences).toMatchObject({ causes: ["carbon_removal", "food_bank"], monthlyCapCents: 1500 });
      expect(log).toHaveBeenCalledWith(`[prefs] ${kind}: secret detail → rules fallback`);
    },
  );

  test("a non-LLM error is a bug and is rethrown", async () => {
    const llm = async (): Promise<Extracted> => {
      throw new TypeError("boom");
    };
    await expect(parsePreferences(DEMO, { llm, userId: "u1" })).rejects.toThrow("boom");
  });

  test("budget spent → rules without calling the LLM", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = vi.fn(async () => llmAnswer);
    const r = await parsePreferences(DEMO, { llm, allowLlm: () => false, userId: "u1" });
    expect(r.source).toBe("rules");
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("POST /api/preferences/parse, LLM_MODE=live", () => {
  beforeEach(() => vi.stubEnv("LLM_MODE", "live"));

  test("returns contract-valid Preferences from the LLM path and does not save", async () => {
    fakeLlm = async () => llmAnswer;
    const before = structuredClone(store().preferences);
    const p = await parsed(await post({ rawText: "ocean, $5 a week" }));
    expect(p).toMatchObject({ userId: "demo-user", rawText: "ocean, $5 a week", causes: ["ocean_plastic"], monthlyCapCents: 2000 });
    expect(store().preferences).toEqual(before);
  });

  test("LLM failure → 200 from rules, never an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeLlm = async () => {
      throw new LlmError("api_error", "credit balance too low");
    };
    const raw = await post({ rawText: DEMO });
    const text = await raw.clone().text();
    expect(await parsed(raw)).toMatchObject({ causes: ["carbon_removal", "food_bank"], monthlyCapCents: 1500, perOrderMaxCents: 500 });
    expect(text).not.toContain("credit balance");
  });

  test("over 20 LLM calls per IP per minute → rules; other IPs unaffected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    fakeLlm = async () => (calls++, llmAnswer);
    for (let i = 0; i < 21; i++) await post({ rawText: DEMO }, "9.9.9.9");
    expect(calls).toBe(20);
    // The 21st came from rules: the demo text's real caps, not llmAnswer's.
    expect((await parsed(await post({ rawText: DEMO }, "9.9.9.9"))).monthlyCapCents).toBe(1500);
    expect((await parsed(await post({ rawText: DEMO }, "8.8.8.8"))).monthlyCapCents).toBe(2000);
    expect(calls).toBe(21);
  });

  test("shares the global daily LLM budget with /api/classify", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { takeGlobalLlmBudget } = await import("@/lib/classifier");
    for (let i = 0; i < GLOBAL_LIMIT.limit; i++) takeGlobalLlmBudget();
    let calls = 0;
    fakeLlm = async () => (calls++, llmAnswer);
    expect((await parsed(await post({ rawText: DEMO }))).monthlyCapCents).toBe(1500);
    expect(calls).toBe(0);
  });

  test("bad body → 400 VALIDATION_ERROR", async () => {
    expect((await post({ rawText: "" })).status).toBe(400);
    expect((await post({ rawText: "x".repeat(1001) })).status).toBe(400);
  });
});

describe("POST /api/preferences/parse, other modes", () => {
  test("LLM_MODE=rules: keyword parser, no LLM call", async () => {
    vi.stubEnv("LLM_MODE", "rules");
    fakeLlm = async () => {
      throw new Error("should not be called");
    };
    expect(await parsed(await post({ rawText: "Skip flights. $8 a month." }))).toMatchObject({
      causes: ["general_fund"],
      optOutCategories: ["air_travel"],
      monthlyCapCents: 800,
      perOrderMaxCents: 500,
    });
  });

  test("LLM_MODE=mock (default): canned demo preferences with the text echoed", async () => {
    const p = await parsed(await post({ rawText: "anything at all" }));
    expect({ ...p, updatedAt: mockPreferences.updatedAt }).toEqual({ ...mockPreferences, rawText: "anything at all" });
  });
});
