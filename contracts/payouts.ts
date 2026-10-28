import { z } from "zod";
import { CauseId, Cents, IsoDateTime } from "./common";

/** POST /api/payouts/run body (header x-admin-token required). */
export const RunPayoutsRequest = z.object({
  dryRun: z.boolean().default(false),
});
export type RunPayoutsRequest = z.infer<typeof RunPayoutsRequest>;

/** "simulated" must show a visible SIMULATED badge in the UI. */
export const PayoutMode = z.enum(["sandbox", "simulated"]);
export type PayoutMode = z.infer<typeof PayoutMode>;

/** Mirrors PayPal batch status, or SIMULATED. */
export const PayoutStatus = z.enum(["PENDING", "PROCESSING", "SUCCESS", "DENIED", "SIMULATED"]);
export type PayoutStatus = z.infer<typeof PayoutStatus>;

export const PayoutItem = z.object({
  causeId: CauseId,
  receiver: z.string(),
  amountCents: Cents,
  ledgerEntryIds: z.array(z.string().min(1)).min(1),
});
export type PayoutItem = z.infer<typeof PayoutItem>;

/**
 * POST /api/payouts/run and GET /api/payouts/:id response.
 * A cause is included only when its pending balance >= thresholdCents.
 */
export const PayoutBatch = z.object({
  id: z.string().min(1),
  mode: PayoutMode,
  senderBatchId: z.string().min(1),
  thresholdCents: Cents,
  items: z.array(PayoutItem),
  paypalPayoutBatchId: z.string().min(1).nullable(),
  status: PayoutStatus,
  createdAt: IsoDateTime,
});
export type PayoutBatch = z.infer<typeof PayoutBatch>;
