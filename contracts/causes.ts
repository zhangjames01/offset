import { z } from "zod";
import { Category, CauseId } from "./common";

/** mocks/causes.json entry (committed). Impact figures stay PLACEHOLDER until sourced. */
export const Cause = z.object({
  id: CauseId,
  name: z.string().min(1),
  categories: z.array(Category).min(1),
  /** PayPal sandbox receiver email. Blank in the repo; set in the DB seed. */
  receiver: z.string(),
  impactNote: z.string(),
});
export type Cause = z.infer<typeof Cause>;

export const CauseRegistry = z.array(Cause);
