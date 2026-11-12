import { CauseId, PayoutBatch, PayoutStatus } from "@/contracts";
import { ApiFailure, handle, modes, ok, requireAdmin } from "@/lib/api";
import { getPrisma } from "@/lib/db";
import { mockPayoutBatch } from "@/lib/mocks";
import { store } from "@/lib/mock-store";
import { reconcileSandboxPayout } from "@/lib/payouts/reconciliation";

export const GET = handle(
  async (req: Request, ctx: RouteContext<"/api/payouts/[id]">) => {
    requireAdmin(req);
    const { id } = await ctx.params;

    // Preserve existing mock behavior.
    if (modes.paypal() === "mock") {
      const s = store();

      const batch =
        s.batches.get(id) ??
        (id === mockPayoutBatch.id ? mockPayoutBatch : undefined);

      if (!batch) {
        throw new ApiFailure("NOT_FOUND", `Unknown payout batch: ${id}`, 404);
      }

      if (batch.status === "PENDING" && s.batches.has(id)) {
        batch.status = "SUCCESS";

        for (const entry of s.ledger) {
          if (entry.payoutBatchId === id) {
            entry.status = "paid_out";
          }
        }
      }

      return ok(PayoutBatch, batch);
    }

    const prisma = getPrisma();

    const batch = await prisma.payoutBatch.findUnique({
      where: { id },
      include: {
        items: true,
        ledgerEntries: true,
      },
    });

    if (!batch) {
      throw new ApiFailure("NOT_FOUND", `Unknown payout batch: ${id}`, 404);
    }

    let status = PayoutStatus.parse(batch.status);

    if (batch.mode === "sandbox" && batch.paypalPayoutBatchId) {
      const result = await reconcileSandboxPayout(id);
      status = result.status;
    }

    // Do not mark individual donations paid_out here.
    // Batch-level status alone does not prove item settlement.

    return ok(PayoutBatch, {
      id: batch.id,
      mode: batch.mode === "sandbox" ? "sandbox" : "simulated",
      senderBatchId: batch.senderBatchId,
      thresholdCents: batch.thresholdCents,
      items: batch.items.map((item) => ({
        causeId: CauseId.parse(item.causeId),
        receiver: item.receiver,
        amountCents: item.amountCents,
        ledgerEntryIds: batch.ledgerEntries
          .filter((entry) => entry.causeId === item.causeId)
          .map((entry) => entry.id),
      })),
      paypalPayoutBatchId: batch.paypalPayoutBatchId,
      status,
      createdAt: batch.createdAt.toISOString(),
    });
  },
);
