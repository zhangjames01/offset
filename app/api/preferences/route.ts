// GET / PUT /api/preferences — owner: Jay. Load / save the demo user's preferences.

import { connection } from "next/server";
import { Preferences, SavePreferencesRequest } from "@/contracts";
import { handle, ok, parseBody, modes } from "@/lib/api";
import { store } from "@/lib/mock-store";
import { mockPreferences } from "@/lib/mocks";
import { getPrisma } from "@/lib/db";

export const GET = handle(async () => {
  await connection();

  if (modes.paypal() !== "sandbox") {
    return ok(Preferences, store().preferences);
  }

  const prisma = getPrisma();
  const saved = await prisma.preferences.findUnique({
    where: { userId: mockPreferences.userId },
  });

  if (!saved) {
    throw new Error("Demo preferences not seeded in Neon");
  }

  return ok(
    Preferences,
    Preferences.parse({
      ...saved,
      updatedAt: saved.updatedAt.toISOString(),
    }), 
  );
});

export const PUT = handle(async (req: Request) => {
  const body = await parseBody(req, SavePreferencesRequest);

  if (modes.paypal() !== "sandbox") {
    const s = store();
    s.preferences = {
      ...body,
      userId: s.preferences.userId,
      updatedAt: new Date().toISOString(),
    };
    return ok(Preferences, s.preferences);
  }

  const prisma = getPrisma();
  const saved = await prisma.preferences.update({
    where: { userId: mockPreferences.userId },
    data: {
      rawText: body.rawText,
      causes: body.causes,
      optOutCategories: body.optOutCategories,
      monthlyCapCents: body.monthlyCapCents,
      perOrderMaxCents: body.perOrderMaxCents,
    },
  });

  return ok(
    Preferences,
    Preferences.parse({
      ...saved,
      updatedAt: saved.updatedAt.toISOString(),
    }),
  );
});
