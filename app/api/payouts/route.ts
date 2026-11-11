
import { z } from "zod";
import { CauseId, PayoutBatch, PayoutStatus } from "@/contracts";
import { handle, modes, ok, requireAdmin } from "@/lib/api";
import { getPrisma } from "@/lib/db";

const PayoutHistory = z.array(PayoutBatch);

export const GET = handle(async (req: Request) => {
  requireAdmin(req);

  // Mock mode uses the in-memory store.
  // We'll add mock history support separately if needed.
  if (modes.paypal() === "mock") {
    return ok(PayoutHistory, []);
  }

  const prisma = getPrisma();

  const batches = await prisma.payoutBatch.findMany({
    orderBy: {
      createdAt: "desc",
    },
    take: 20,
    include: {
      items: true,
      ledgerEntries: true,
    },
  });

  const history = batches.map((batch) => ({
    id: batch.id,
    mode: batch.mode === "sandbox" ? "sandbox" as const : "simulated" as const,
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
    status: PayoutStatus.parse(batch.status),
    createdAt: batch.createdAt.toISOString(),
  }));

  return ok(PayoutHistory, history);
});
