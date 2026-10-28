// POST /api/preferences/parse — owner: James (A4). Plain text → Preferences.
import { ParsePreferencesRequest, Preferences } from "@/contracts";
import { handle, modes, notImplemented, ok, parseBody } from "@/lib/api";
import { mockPreferences } from "@/lib/mocks";

export const POST = handle(async (req: Request) => {
  const { rawText } = await parseBody(req, ParsePreferencesRequest);

  if (modes.llm() !== "mock") notImplemented("LLM preferences parsing", "A4");

  // Mock: echo the text into the canned demo preferences. Does NOT save (PUT does).
  return ok(Preferences, { ...mockPreferences, rawText, updatedAt: new Date().toISOString() });
});
