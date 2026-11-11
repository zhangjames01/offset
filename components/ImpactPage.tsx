"use client";

import { useEffect, useState } from "react";
import { LedgerResponse } from "@/contracts";
import { getJson } from "@/lib/api-client";
import { formatCents } from "@/lib/cart";
import { CATEGORY_LABEL } from "@/lib/donation";
import { LEDGER_STATUS_LABEL, newestFirst, shortName, totalCents, type CauseInfo } from "@/lib/impact";
import { CauseBalances } from "./CauseBalances";
import { LoadError } from "./LoadError";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: LedgerResponse };

export function ImpactPage({ causes }: { causes: CauseInfo[] }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/ledger", LedgerResponse)
      .then((data) => !cancelled && setLoad({ status: "ok", data }))
      .catch((e: unknown) => !cancelled && setLoad({ status: "error", message: e instanceof Error ? e.message : "Couldn't load" }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const causeName = (id: string) => shortName(causes.find((c) => c.id === id)?.name ?? id);

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Your impact</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every donation is recorded here, then paid out to its cause once the balance reaches the threshold.
      </p>

      {load.status === "loading" && <p className="mt-6 text-zinc-500">Loading…</p>}
      {load.status === "error" && (
        <div className="mt-6">
          <LoadError
            message="Couldn't load donations. Check your connection and try again."
            onRetry={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          />
        </div>
      )}
      {load.status === "ok" && (
        <>
            <p className="mt-6 text-3xl font-semibold tabular-nums">{formatCents(totalCents(load.data.entries))}</p>
            <p className="text-sm text-zinc-500">
              donated across {load.data.entries.length} {load.data.entries.length === 1 ? "order" : "orders"}
            </p>

            <section className="mt-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="mb-4 font-semibold">Causes</h2>
              <CauseBalances balances={load.data.balances} causes={causes} />
              <p className="mt-4 text-xs text-zinc-500">All causes are placeholder partners.</p>
            </section>

            <section className="mt-8">
              <h2 className="mb-2 font-semibold">Donations</h2>
              {load.data.entries.length === 0 ? (
                <p className="text-sm text-zinc-500">No donations yet. Check out with a donation to see it here.</p>
              ) : (
                <>
                {/* Phones: a stacked list, since the five-column table doesn't fit. */}
                <ul className="divide-y divide-zinc-100 sm:hidden dark:divide-zinc-900">
                  {newestFirst(load.data.entries).map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                      <div>
                        <p>{causeName(e.causeId)}</p>
                        <p className="text-xs text-zinc-500">
                          {new Date(e.createdAt).toLocaleDateString()} · {CATEGORY_LABEL[e.category]}
                          {e.userAction === "edited" && " · edited"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tabular-nums">{formatCents(e.amountCents)}</p>
                        <StatusBadge status={e.status} />
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-xs text-zinc-500">
                      <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className="py-2 font-normal">Date</th>
                        <th className="py-2 font-normal">Cause</th>
                        <th className="py-2 font-normal">For</th>
                        <th className="py-2 text-right font-normal">Amount</th>
                        <th className="py-2 pl-4 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newestFirst(load.data.entries).map((e) => (
                        <tr key={e.id} className="border-b border-zinc-100 dark:border-zinc-900">
                          <td className="py-2 text-zinc-500">{new Date(e.createdAt).toLocaleDateString()}</td>
                          <td className="py-2">{causeName(e.causeId)}</td>
                          <td className="py-2 text-zinc-500">
                            {CATEGORY_LABEL[e.category]}
                            {e.userAction === "edited" && " · edited"}
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatCents(e.amountCents)}</td>
                          <td className="py-2 pl-4">
                            <StatusBadge status={e.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: keyof typeof LEDGER_STATUS_LABEL }) {
  const tone =
    status === "pending_payout"
      ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      : status === "paid_out"
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
        : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${tone}`}>{LEDGER_STATUS_LABEL[status]}</span>;
}
