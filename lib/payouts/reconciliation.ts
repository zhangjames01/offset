import { getPrisma } from "@/lib/db";
import { getSandboxPayout } from "@/lib/paypal/payouts";

export async function reconcileSandboxPayout(batchId: string) {
  const prisma = getPrisma();

  const batch = await prisma.payoutBatch.findUnique({
    where: { id: batchId },
    include: {
      items: true,
    },
  });

  if (!batch) {
    throw new Error(`Unknown payout batch: ${batchId}`);
  }

  if (batch.mode !== "sandbox" || !batch.paypalPayoutBatchId) {
    throw new Error("Batch is not a submitted Sandbox payout");
  }

  const result = await getSandboxPayout(batch.paypalPayoutBatchId);

  // Match PayPal items using the stable sender_item_id
  // generated when the payout was submitted.

  const successfulCauseIds: string[] = [];

  const paypalItems = result.items ?? [];

  // Never treat a missing or incomplete PayPal item list
  // as confirmation that all donations were paid.
  if (paypalItems.length !== batch.items.length) {
    throw new Error(
      `Incomplete PayPal payout items: expected ${batch.items.length}, received ${paypalItems.length}`,
    );
  }

  const matchedCauseIds = new Set<string>();
  const matchedSenderIds = new Set<string>();

  for (const paypalItem of paypalItems) {
    // PayPal sender IDs use the original submission index.
    if (!paypalItem.senderItemId.startsWith(`${batch.senderBatchId}-`)) {
      throw new Error("Unexpected PayPal sender item ID");
    }

    const indexText = paypalItem.senderItemId.slice(
      batch.senderBatchId.length + 1,
    );

    if (!/^(0|[1-9]\d*)$/.test(indexText)) {
      throw new Error("Invalid PayPal sender item index");
    }

    const index = Number(indexText);

    if (
      !Number.isSafeInteger(index) ||
      index >= batch.items.length ||
      matchedSenderIds.has(paypalItem.senderItemId)
    ) {
      throw new Error("Duplicate or invalid PayPal payout item");
    }

    matchedSenderIds.add(paypalItem.senderItemId);

    const matchingItems = batch.items.filter(
      (item) => item.receiver === paypalItem.receiver,
    );

    if (matchingItems.length !== 1) {
      throw new Error(
        `Cannot uniquely match payout receiver: ${paypalItem.receiver}`,
      );
    }

    const item = matchingItems[0];

    if (matchedCauseIds.has(item.causeId)) {
      throw new Error("Duplicate payout cause match");
    }

    matchedCauseIds.add(item.causeId);

    if (paypalItem.status === "SUCCESS") {
      successfulCauseIds.push(item.causeId);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: result.status,
      },
    });

    for (const causeId of successfulCauseIds) {
      await tx.ledgerEntry.updateMany({
        where: {
          payoutBatchId: batchId,
          causeId,
          status: "pending_payout",
        },
        data: {
          status: "paid_out",
        },
      });
    }
  });

  return result;
}
