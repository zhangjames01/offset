// GET /api/ledger — owner: Jay (J7). Entries + balance per cause.

import { connection } from "next/server";
import {
  CauseId,
  LedgerResponse,
  type LedgerEntry,
} from "@/contracts";
import { handle, ok, payoutThresholdCents } from "@/lib/api";
import { getPrisma } from "@/lib/db";
import { computeBalances } from "@/lib/ledger/balances";
import { mockCauses } from "@/lib/mocks";
import { store } from "@/lib/mock-store";

export const GET = handle(async () => {
  await connection();

  const thresholdCents = payoutThresholdCents();

  // Preserve existing mock-mode behavior.
  if (process.env.PAYPAL_MODE !== "sandbox") {
    const entries = store().ledger;

    return ok(LedgerResponse, {
      entries,
      balances: computeBalances(
        entries,
        mockCauses.map((cause) => cause.id),
        thresholdCents,
      ),
    });
  }

  // Sandbox mode must use the same Neon database
  // that checkout capture and payout batching use.
  const prisma = getPrisma();

  const [rows, causes] = await Promise.all([
    prisma.ledgerEntry.findMany({
      orderBy: { createdAt: "desc" },
    }),
    prisma.cause.findMany({
      select: { id: true },
    }),
  ]);

  const entries: LedgerEntry[] = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    localOrderId: row.localOrderId,
    paypalOrderId: row.paypalOrderId,
    paypalCaptureId: row.paypalCaptureId,
    category: row.category as LedgerEntry["category"],
    causeId: CauseId.parse(row.causeId),
    amountCents: row.amountCents,
    userAction: row.userAction as LedgerEntry["userAction"],
    classificationSource:
      row.classificationSource as LedgerEntry["classificationSource"],
    status: row.status as LedgerEntry["status"],
    payoutBatchId: row.payoutBatchId,
    createdAt: row.createdAt.toISOString(),
  }));

  const causeIds = causes.map((cause) =>
    CauseId.parse(cause.id),
  );

  return ok(LedgerResponse, {
    entries,
    balances: computeBalances(
      entries,
      causeIds,
      thresholdCents,
    ),
  });
});
