// Impact + admin page logic (H6). Pure functions so they're unit-testable.
import type { CauseBalance, CauseId, LedgerEntry, LedgerStatus, PayoutBatch } from "@/contracts";

export type CauseInfo = { id: CauseId; name: string; impactNote: string };

export const LEDGER_STATUS_LABEL: Record<LedgerStatus, string> = {
  pending_payout: "Pending payout",
  paid_out: "Paid out",
  simulated_paid_out: "Paid out (simulated)",
};

/** How far a cause's pending balance is toward the payout threshold. */
export function thresholdProgress(b: CauseBalance): { pct: number; ready: boolean; toGoCents: number } {
  const ready = b.pendingCents > 0 && b.pendingCents >= b.thresholdCents;
  const pct = b.thresholdCents > 0 ? Math.min(100, Math.round((b.pendingCents / b.thresholdCents) * 100)) : ready ? 100 : 0;
  return { pct, ready, toGoCents: Math.max(0, b.thresholdCents - b.pendingCents) };
}

/** Newest first. */
export function newestFirst(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function totalCents(entries: LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amountCents, 0);
}

export function batchTotalCents(b: PayoutBatch): number {
  return b.items.reduce((sum, i) => sum + i.amountCents, 0);
}

/** Only a real (sandbox) batch that PayPal hasn't settled yet has a status worth refreshing. */
export function canRefresh(b: PayoutBatch): boolean {
  return b.mode === "sandbox" && (b.status === "PENDING" || b.status === "PROCESSING");
}

/** "Carbon removal (placeholder partner)" → "Carbon removal". The page labels placeholders separately. */
export function shortName(name: string): string {
  return name.replace(/\s*\(placeholder partner\)$/, "");
}
