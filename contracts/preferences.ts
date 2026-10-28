import { z } from "zod";
import { Category, CauseId, Cents, IsoDateTime } from "./common";

/** Returned by POST /api/preferences/parse, stored by PUT /api/preferences. */
export const Preferences = z.object({
  userId: z.string().min(1),
  rawText: z.string(),
  causes: z.array(CauseId),
  optOutCategories: z.array(Category),
  monthlyCapCents: Cents,
  perOrderMaxCents: Cents,
  updatedAt: IsoDateTime,
});
export type Preferences = z.infer<typeof Preferences>;

/** POST /api/preferences/parse body. */
export const ParsePreferencesRequest = z.object({
  rawText: z.string().min(1).max(1000),
});
export type ParsePreferencesRequest = z.infer<typeof ParsePreferencesRequest>;

/** PUT /api/preferences body (server sets userId + updatedAt). */
export const SavePreferencesRequest = Preferences.omit({ userId: true, updatedAt: true });
export type SavePreferencesRequest = z.infer<typeof SavePreferencesRequest>;
