import { getPrisma } from "@/lib/db";
import { getSandboxPayout } from "@/lib/paypal/payouts";

export async function reconcileSandboxPayout(batchId: string) {
  const prisma = getPrisma();

  const batch = await prisma.payoutBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });

  if (!batch) {
    throw new Error(`Unknown payout batch: ${batchId}`);
  }

  if (batch.mode !== "sandbox" || !batch.paypalPayoutBatchId) {
    throw new Error("Batch is not a submitted Sandbox payout");
  }

  const result = await getSandboxPayout(batch.paypalPayoutBatchId);

  if (result.paypalPayoutBatchId !== batch.paypalPayoutBatchId) {
    throw new Error("Unexpected PayPal payout batch ID");
  }

  const paypalItems = result.items ?? [];

  if (paypalItems.length !== batch.items.length) {
    throw new Error(
      `Incomplete PayPal payout items: expected ${batch.items.length}, received ${paypalItems.length}`,
    );
  }

  const successfulCauseIds: string[] = [];
  const failedCauseIds: string[] = [];
  const matchedCauseIds = new Set<string>();

  for (const paypalItem of paypalItems) {
    let item = batch.items.find(
      (candidate) =>
        paypalItem.senderItemId ===
        `${batch.senderBatchId}-${candidate.causeId}`,
    );

    // Compatibility with previously submitted single-item
    // Sandbox batches that used an index-based sender ID.
    if (
      !item &&
      batch.items.length === 1 &&
      paypalItem.senderItemId === `${batch.senderBatchId}-0`
    ) {
      item = batch.items[0];
    }

    if (!item) {
      throw new Error(
        `Unexpected PayPal sender item ID: ${paypalItem.senderItemId}`,
      );
    }

    if (matchedCauseIds.has(item.causeId)) {
      throw new Error("Duplicate PayPal payout item");
    }

    if (paypalItem.receiver !== item.receiver) {
      throw new Error(`PayPal payout receiver mismatch for ${item.causeId}`);
    }

    matchedCauseIds.add(item.causeId);

    if (paypalItem.status === "SUCCESS") {
      successfulCauseIds.push(item.causeId);
    } else if (
      paypalItem.status === "FAILED" ||
      paypalItem.status === "RETURNED"
    ) {
      failedCauseIds.push(item.causeId);
    }
  }

  if (matchedCauseIds.size !== batch.items.length) {
    throw new Error("Not all payout items were matched");
  }

  await prisma.$transaction(async (tx) => {
    await tx.payoutBatch.update({
      where: { id: batchId },
      data: { status: result.status },
    });

    for (const causeId of successfulCauseIds) {
      await tx.ledgerEntry.updateMany({
        where: {
          payoutBatchId: batchId,
          causeId,
          status: "pending_payout",
        },
        data: { status: "paid_out" },
      });
    }

    for (const causeId of failedCauseIds) {
      await tx.ledgerEntry.updateMany({
        where: {
          payoutBatchId: batchId,
          causeId,
          status: "pending_payout",
        },
        data: {
          payoutBatchId: null,
        },
      });
    }
  });

  return result;
}
