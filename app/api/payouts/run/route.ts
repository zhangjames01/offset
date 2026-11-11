// POST /api/payouts/run — owner: Jay (J6). Threshold batching → PayoutBatch. Admin token required.
import { CauseId, PayoutBatch, PayoutStatus, RunPayoutsRequest } from "@/contracts";
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

import { getPrisma } from "@/lib/db";
import { claimPayoutBatch } from "@/lib/payouts/batching";
import { executeSandboxPayout } from "@/lib/payouts/execution";


async function runDatabasePayout(
  dryRun: boolean,
  mode: "sandbox" | "simulated",
) {
  const prisma = getPrisma();
  const thresholdCents = payoutThresholdCents();

  if (dryRun) {
    const pending = await prisma.ledgerEntry.findMany({
      where: {
        status: "pending_payout",
        payoutBatchId: null,
      },
      include: { cause: true },
    });

const grouped = new Map<string, PayoutItem>();

    for (const entry of pending) {
      const existing = grouped.get(entry.causeId);

      if (existing) {
        existing.amountCents += entry.amountCents;
        existing.ledgerEntryIds.push(entry.id);
      } else {
        grouped.set(entry.causeId, {
  causeId: CauseId.parse(entry.causeId),
  receiver: entry.cause.receiver,
  amountCents: entry.amountCents,
  ledgerEntryIds: [entry.id],
});
      }
    }

    const items = [...grouped.values()].filter(
      (item) => item.amountCents >= thresholdCents,
    );

    return ok(PayoutBatch, {
      id: "preview",
      mode,
      senderBatchId: "preview-only",
      thresholdCents,
      items,
      paypalPayoutBatchId: null,
      status: mode === "simulated" ? "SIMULATED" : "PENDING",
      createdAt: new Date().toISOString(),
    });
  }

  const claimed = await claimPayoutBatch(thresholdCents, mode);

  if (!claimed) {
    return ok(PayoutBatch, {
      id: "empty",
      mode,
      senderBatchId: "no-eligible-donations",
      thresholdCents,
      items: [],
      paypalPayoutBatchId: null,
      status: mode === "simulated" ? "SIMULATED" : "PENDING",
      createdAt: new Date().toISOString(),
    });
  }

  if (mode === "simulated") {
    return ok(
      PayoutBatch,
      {
        ...claimed,
        mode,
        paypalPayoutBatchId: null,
        status: "SIMULATED",
        createdAt: new Date().toISOString(),
      },
      201,
    );
  }

  const executed = await executeSandboxPayout(claimed.id);

  return ok(
    PayoutBatch,
    {
      id: executed.id,
      mode: "sandbox",
      senderBatchId: executed.senderBatchId,
      thresholdCents: executed.thresholdCents,
      items: claimed.items,
      paypalPayoutBatchId: executed.paypalPayoutBatchId,
      status: PayoutStatus.parse(executed.status),
      createdAt: executed.createdAt.toISOString(),
    },
    201,
  );
}



export const POST = handle(async (req: Request) => {
  requireAdmin(req);
  const { dryRun } = await parseBody(req, RunPayoutsRequest);

const mode = modes.payout();

if (modes.paypal() !== "mock") {
  return runDatabasePayout(dryRun, mode);
}

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
