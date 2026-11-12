import { ApiFailure } from "@/lib/api";
import { CauseId } from "@/contracts";
import type { PayoutItem } from "@/contracts";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/db";

export type ClaimedPayoutItem = PayoutItem;

export type ClaimedPayoutBatch = {
  id: string;
  senderBatchId: string;
  thresholdCents: number;
  items: ClaimedPayoutItem[];
};

/**
 * Atomically claims eligible donations for one payout batch.
 *
 * The database transaction uses Serializable isolation to
 * prevent concurrent requests from claiming the same entries.
 */
export async function claimPayoutBatch(
  thresholdCents: number,
  mode: "sandbox" | "simulated",
): Promise<ClaimedPayoutBatch | null> {
  if (!Number.isSafeInteger(thresholdCents) || thresholdCents <= 0) {
    throw new Error("Invalid payout threshold");
  }

  const prisma = getPrisma();

  return prisma.$transaction(
    async (tx) => {
      const pending = await tx.ledgerEntry.findMany({
        where: {
          status: "pending_payout",
          payoutBatchId: null,
        },
        orderBy: { createdAt: "asc" },
      });

      const causes = await tx.cause.findMany();

      const items: ClaimedPayoutItem[] = [];

      for (const cause of causes) {
        const entries = pending.filter((entry) => entry.causeId === cause.id);

        const amountCents = entries.reduce(
          (sum, entry) => sum + entry.amountCents,
          0,
        );

        if (entries.length === 0 || amountCents < thresholdCents) {
          continue;
        }

        if (mode === "sandbox" && !cause.receiver.trim()) {
          throw new ApiFailure(
            "PAYOUT_FAILED",
            `Missing payout receiver for cause ${cause.id}`,
            422,
          );
        }

        items.push({
          causeId: CauseId.parse(cause.id),
          receiver: cause.receiver,
          amountCents,
          ledgerEntryIds: entries.map((entry) => entry.id),
        });
      }

      if (items.length === 0) {
        return null;
      }

      const senderBatchId = `offset-${randomUUID()}`;

      const batch = await tx.payoutBatch.create({
        data: {
          mode,
          senderBatchId,
          thresholdCents,
          status: mode === "simulated" ? "SIMULATED" : "PENDING",
          items: {
            create: items.map((item) => ({
              causeId: item.causeId,
              receiver: item.receiver,
              amountCents: item.amountCents,
            })),
          },
        },
      });

      for (const item of items) {
        const result = await tx.ledgerEntry.updateMany({
          where: {
            id: { in: item.ledgerEntryIds },
            status: "pending_payout",
            payoutBatchId: null,
          },
          data: {
            payoutBatchId: batch.id,
            ...(mode === "simulated" ? { status: "simulated_paid_out" } : {}),
          },
        });

        if (result.count !== item.ledgerEntryIds.length) {
          throw new Error(
            `Concurrent payout claim detected for ${item.causeId}`,
          );
        }
      }

      return {
        id: batch.id,
        senderBatchId,
        thresholdCents,
        items,
      };
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5000,
      timeout: 10000,
    },
  );
}
