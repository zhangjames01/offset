// POST /api/payouts/run — owner: Jay (J6). Threshold batching → PayoutBatch. Admin token required.
import { PayoutBatch, RunPayoutsRequest } from "@/contracts";
import type { PayoutItem } from "@/contracts";
import {
  handle,
  modes,
  notImplemented,
  ok,
  parseBody,
  payoutThresholdCents,
  requireAdmin,
} from "@/lib/api";
import { mockCauses } from "@/lib/mocks";
import { nextId, store } from "@/lib/mock-store";

export const POST = handle(async (req: Request) => {
  requireAdmin(req);
  const { dryRun } = await parseBody(req, RunPayoutsRequest);

  const mode = modes.payout();
  if (mode === "sandbox" && modes.paypal() !== "mock") notImplemented("PayPal sandbox payouts", "J6");

  const s = store();
  const thresholdCents = payoutThresholdCents();
  const pending = s.ledger.filter((e) => e.status === "pending_payout" && e.payoutBatchId === null);

  const items: PayoutItem[] = [];
  for (const cause of mockCauses) {
    const mine = pending.filter((e) => e.causeId === cause.id);
    const amountCents = mine.reduce((sum, e) => sum + e.amountCents, 0);
    if (mine.length > 0 && amountCents >= thresholdCents) {
      items.push({
        causeId: cause.id,
        receiver: cause.receiver || `${cause.id}@sandbox.example`,
        amountCents,
        ledgerEntryIds: mine.map((e) => e.id),
      });
    }
  }

  const id = nextId("pb_mock_");
  const batch: PayoutBatch = {
    id,
    mode,
    senderBatchId: `offset-${new Date().toISOString().slice(0, 10)}-${id}`,
    thresholdCents,
    items,
    paypalPayoutBatchId: mode === "simulated" ? null : nextId("MOCKBATCH"),
    status: mode === "simulated" ? "SIMULATED" : "PENDING",
    createdAt: new Date().toISOString(),
  };

  if (!dryRun) {
    const ids = new Set(items.flatMap((i) => i.ledgerEntryIds));
    for (const e of s.ledger) {
      if (!ids.has(e.id)) continue;
      e.payoutBatchId = id;
      if (mode === "simulated") e.status = "simulated_paid_out";
    }
    s.batches.set(id, batch);
  }

  return ok(PayoutBatch, batch, dryRun ? 200 : 201);
});
