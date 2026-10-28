// GET /api/payouts/:id — owner: Jay (J7). Refresh batch status from PayPal.
import { PayoutBatch } from "@/contracts";
import { ApiFailure, handle, modes, notImplemented, ok } from "@/lib/api";
import { mockPayoutBatch } from "@/lib/mocks";
import { store } from "@/lib/mock-store";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/payouts/[id]">) => {
  const { id } = await ctx.params;
  const s = store();
  const batch = s.batches.get(id) ?? (id === mockPayoutBatch.id ? mockPayoutBatch : undefined);
  if (!batch) throw new ApiFailure("NOT_FOUND", `Unknown payout batch: ${id}`, 404);

  if (batch.mode === "sandbox" && modes.paypal() !== "mock") notImplemented("PayPal payout status", "J7");

  // Mock: a PENDING sandbox batch "settles" on the first refresh.
  if (batch.status === "PENDING" && s.batches.has(id)) {
    batch.status = "SUCCESS";
    for (const e of s.ledger) if (e.payoutBatchId === id) e.status = "paid_out";
  }
  return ok(PayoutBatch, batch);
});
