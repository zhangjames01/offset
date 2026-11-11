import type { CauseBalance } from "@/contracts";
import { formatCents } from "@/lib/cart";
import { shortName, thresholdProgress, type CauseInfo } from "@/lib/impact";

/** Per-cause pending balance vs the payout threshold. Shared by /impact and /admin. */
export function CauseBalances({ balances, causes }: { balances: CauseBalance[]; causes: CauseInfo[] }) {
  const name = (id: string) => shortName(causes.find((c) => c.id === id)?.name ?? id);
  return (
    <ul className="space-y-4">
      {balances.map((b) => {
        const p = thresholdProgress(b);
        return (
          <li key={b.causeId}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="font-medium">{name(b.causeId)}</span>
              <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                {formatCents(b.pendingCents)} / {formatCents(b.thresholdCents)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`${name(b.causeId)} toward payout threshold`}
              aria-valuenow={p.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            >
              <div className={`h-full ${p.ready ? "bg-emerald-600" : "bg-emerald-400/70"}`} style={{ width: `${p.pct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-zinc-500">
              <span>{p.ready ? "Ready for the next payout" : `${formatCents(p.toGoCents)} to go`}</span>
              {b.paidOutCents > 0 && <span className="tabular-nums">{formatCents(b.paidOutCents)} paid out</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
