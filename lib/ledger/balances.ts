import type { CauseBalance, CauseId, LedgerEntry } from "@/contracts";

/**
 * Per-cause balances. "Pending" = pending_payout and not yet in a batch.
 * Pure function so Jay can reuse it with DB rows.
 */
export function computeBalances(
  entries: LedgerEntry[],
  causeIds: CauseId[],
  thresholdCents: number,
): CauseBalance[] {
  return causeIds.map((causeId) => {
    const mine = entries.filter((e) => e.causeId === causeId);
    const pendingCents = mine
      .filter((e) => e.status === "pending_payout" && e.payoutBatchId === null)
      .reduce((sum, e) => sum + e.amountCents, 0);
    const paidOutCents = mine
      .filter((e) => e.status === "paid_out" || e.status === "simulated_paid_out")
      .reduce((sum, e) => sum + e.amountCents, 0);
    return { causeId, pendingCents, paidOutCents, thresholdCents };
  });
}
