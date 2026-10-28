import { z } from "zod";
import { Category, CauseId, Cents, IsoDateTime, UserAction } from "./common";
import { ClassificationSource } from "./classify";

export const LedgerStatus = z.enum(["pending_payout", "paid_out", "simulated_paid_out"]);
export type LedgerStatus = z.infer<typeof LedgerStatus>;

/** DB row and GET /api/ledger item. */
export const LedgerEntry = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  localOrderId: z.string().min(1),
  paypalOrderId: z.string().min(1),
  paypalCaptureId: z.string().min(1),
  category: Category,
  causeId: CauseId,
  amountCents: Cents,
  userAction: UserAction,
  classificationSource: ClassificationSource,
  status: LedgerStatus,
  payoutBatchId: z.string().min(1).nullable(),
  createdAt: IsoDateTime,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const CauseBalance = z.object({
  causeId: CauseId,
  pendingCents: Cents,
  paidOutCents: Cents,
  thresholdCents: Cents,
});
export type CauseBalance = z.infer<typeof CauseBalance>;

/** GET /api/ledger response. */
export const LedgerResponse = z.object({
  entries: z.array(LedgerEntry),
  balances: z.array(CauseBalance),
});
export type LedgerResponse = z.infer<typeof LedgerResponse>;
