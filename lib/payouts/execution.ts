
import { getPrisma } from "@/lib/db";
import { createSandboxPayout } from "@/lib/paypal/payouts";

/**
 * Submits a previously claimed payout batch to PayPal.
 *
 * The batch must already exist in Neon with a stable
 * senderBatchId and associated ledger entries.
 */
export async function executeSandboxPayout(batchId: string) {
  const prisma = getPrisma();

  const batch = await prisma.payoutBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });

  if (!batch) {
    throw new Error(`Unknown payout batch: ${batchId}`);
  }

  if (batch.mode !== "sandbox") {
    throw new Error("Batch is not configured for Sandbox payouts");
  }

  if (batch.paypalPayoutBatchId) {
    return batch;
  }

  // Claim the submission before contacting PayPal.
  // This prevents ordinary duplicate requests from
  // immediately submitting the same batch twice.
  const claim = await prisma.payoutBatch.updateMany({
    where: {
      id: batchId,
      status: "PENDING",
      paypalPayoutBatchId: null,
    },
    data: { status: "PROCESSING" },
  });

  if (claim.count !== 1) {
    throw new Error(
      "Payout submission is already in progress or requires reconciliation",
    );
  }

  try {
    const result = await createSandboxPayout(
      batch.senderBatchId,
      batch.items.map((item) => ({
        causeId: item.causeId,
        receiver: item.receiver,
        amountCents: item.amountCents,
      })),
    );

    return await prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        paypalPayoutBatchId: result.paypalPayoutBatchId,
        status: result.status,
      },
    });
  } catch (error) {
    // Keep PROCESSING: PayPal might have accepted the payout.
    // Do not automatically reset to PENDING or create another batch.
    throw error;
  }
}
