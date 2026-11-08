// POST /api/preferences/parse — owner: James (A4). Plain text → Preferences. Does NOT save (PUT does).
// live: LLM → rules fallback (never fails). rules: keyword parser only. mock: canned demo preferences.
import { ParsePreferencesRequest, Preferences } from "@/contracts";
import { handle, modes, ok, parseBody } from "@/lib/api";
import { mockPreferences } from "@/lib/mocks";
import { store } from "@/lib/mock-store";
import { livePreferencesDeps, parsePreferences } from "@/lib/preferences-parser";
import { clientIp } from "@/lib/rate-limit";

export const POST = handle(async (req: Request) => {
  const { rawText } = await parseBody(req, ParsePreferencesRequest);
  const mode = modes.llm();
  // TODO(J2): the signed-in user instead of the mock store's demo user.
  const userId = store().preferences.userId;

  if (mode === "live") {
    return ok(Preferences, (await parsePreferences(rawText, livePreferencesDeps(clientIp(req), userId))).preferences);
  }
  if (mode === "rules") return ok(Preferences, (await parsePreferences(rawText, { userId })).preferences);

  // Mock: echo the text into the canned demo preferences.
  return ok(Preferences, { ...mockPreferences, rawText, updatedAt: new Date().toISOString() });
});
