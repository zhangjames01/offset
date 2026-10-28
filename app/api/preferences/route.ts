// GET / PUT /api/preferences — owner: Jay. Load / save the demo user's preferences.
import { connection } from "next/server";
import { Preferences, SavePreferencesRequest } from "@/contracts";
import { handle, ok, parseBody } from "@/lib/api";
import { store } from "@/lib/mock-store";

// TODO(J2): read/write the Preferences table instead of the mock store.

export const GET = handle(async () => {
  await connection(); // runtime data: don't prerender at build
  return ok(Preferences, store().preferences);
});

export const PUT = handle(async (req: Request) => {
  const body = await parseBody(req, SavePreferencesRequest);
  const s = store();
  s.preferences = { ...body, userId: s.preferences.userId, updatedAt: new Date().toISOString() };
  return ok(Preferences, s.preferences);
});
