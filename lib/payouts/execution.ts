import { getPrisma } from "@/lib/db";
import {
  createSandboxPayout,
  DefinitivePayoutRejection,
} from "@/lib/paypal/payouts";
import { getAccessToken } from "@/lib/paypal/client";
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

  // Obtain credentials before claiming the batch.
  // A token failure cannot strand donations in PROCESSING.
  const accessToken = await getAccessToken();

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
      accessToken,
    );

    return await prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        paypalPayoutBatchId: result.paypalPayoutBatchId,
        status: result.status,
      },
    });
  } catch (error) {
    if (error instanceof DefinitivePayoutRejection) {
      await prisma.$transaction(async (tx) => {
        const released = await tx.payoutBatch.updateMany({
          where: {
            id: batchId,
            status: "PROCESSING",
            paypalPayoutBatchId: null,
          },
          data: {
            status: "DENIED",
          },
        });

        if (released.count !== 1) {
          throw new Error("Payout state changed during rejection recovery");
        }

        await tx.ledgerEntry.updateMany({
          where: {
            payoutBatchId: batchId,
            status: "pending_payout",
          },
          data: {
            payoutBatchId: null,
          },
        });
      });
    }

    // Ambiguous outcomes remain PROCESSING.
    // Never release or automatically resubmit them.
    throw error;
  }
}
