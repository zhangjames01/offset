// GET /api/ledger — owner: Jay (J7). Entries + balance per cause.
import { connection } from "next/server";
import { LedgerResponse } from "@/contracts";
import { handle, ok, payoutThresholdCents } from "@/lib/api";
import { computeBalances } from "@/lib/ledger/balances";
import { mockCauses } from "@/lib/mocks";
import { store } from "@/lib/mock-store";

// TODO(J7): read LedgerEntry rows from the DB instead of the mock store.

export const GET = handle(async () => {
  await connection(); // runtime data: don't prerender at build
  const entries = store().ledger;
  return ok(LedgerResponse, {
    entries,
    balances: computeBalances(
      entries,
      mockCauses.map((c) => c.id),
      payoutThresholdCents(),
    ),
  });
});
