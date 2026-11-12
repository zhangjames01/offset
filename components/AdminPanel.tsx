"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { LedgerResponse, PayoutBatch } from "@/contracts";
import { getJson, postJson } from "@/lib/api-client";
import { formatCents } from "@/lib/cart";
import { batchTotalCents, canRefresh, shortName, type CauseInfo } from "@/lib/impact";
import { CauseBalances } from "./CauseBalances";
import { LoadError } from "./LoadError";

const PayoutHistory = z.array(PayoutBatch);
type Props = { causes: CauseInfo[]; payoutMode: "sandbox" | "simulated"; devToken: string };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export function AdminPanel({ causes, payoutMode, devToken }: Props) {
  const [token, setToken] = useState(devToken);
  const [activeToken, setActiveToken] = useState(devToken);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [batch, setBatch] = useState<{ b: PayoutBatch; dryRun: boolean } | null>(null);
  const [history, setHistory] = useState<PayoutBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLedgerError(null);
    getJson("/api/ledger", LedgerResponse).then(setLedger, (e: unknown) => setLedgerError(errMsg(e)));
  }, []);

  const reloadHistory = useCallback(async () => {
    if (!activeToken) {
      setHistory([]);
      return;
    }

    const batches = await getJson(
      "/api/payouts",
      PayoutHistory,
      { "x-admin-token": activeToken },
    );

    setHistory(batches);
  }, [activeToken]);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/ledger", LedgerResponse).then(
      (l) => !cancelled && setLedger(l),
      (e: unknown) => !cancelled && setLedgerError(errMsg(e)),
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeToken) {
      return;
    }

    let cancelled = false;

    getJson(
      "/api/payouts",
      PayoutHistory,
      { "x-admin-token": activeToken },
    ).then(
      (batches) => {
        if (!cancelled) setHistory(batches);
      },
      (e: unknown) => {
        if (!cancelled) setError(errMsg(e));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [activeToken]);

  async function run(dryRun: boolean) {
    if (!dryRun && !window.confirm("Run payout now? This will start the payout batch.")) return;
    setBusy(dryRun ? "Previewing…" : "Running payout…");
    setError(null);
    try {
      const b = await postJson("/api/payouts/run", { dryRun }, PayoutBatch, { "x-admin-token": activeToken });
      setBatch({ b, dryRun });
      if (!dryRun) {
        setSelectedBatchId(b.id);
        reload();
        await reloadHistory();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function refresh(id: string) {
    setBusy("Refreshing status…");
    setError(null);
    try {

      const b = await getJson(
        `/api/payouts/${encodeURIComponent(id)}`,
        PayoutBatch,
        { "x-admin-token": activeToken },
      );
      setBatch({ b, dryRun: false });
      setSelectedBatchId(b.id);
      reload();
      await reloadHistory();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const causeName = (id: string) => shortName(causes.find((c) => c.id === id)?.name ?? id);
  const selectedHistoryBatch = history.find((b) => b.id === selectedBatchId) ?? history[0];
  const displayedBatch = batch ?? (selectedHistoryBatch ? { b: selectedHistoryBatch, dryRun: false } : null);

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Payouts</h1>
        {payoutMode === "simulated" && <SimulatedBadge />}
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Pays each cause whose pending balance has reached the threshold, in one batch.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-4 font-semibold">Pending balances</h2>
          {ledgerError ? (
            <LoadError message="Couldn't load balances." detail={ledgerError} onRetry={reload} />
          ) : ledger ? (
            <CauseBalances balances={ledger.balances} causes={causes} />
          ) : (
            <p className="text-sm text-zinc-500">Loading…</p>
          )}
        </section>

        <section className="h-fit rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <label htmlFor="admin-token" className="text-sm font-medium">Admin token</label>
          <input
            id="admin-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            className="mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
          <button
            type="button"
            onClick={() => {
              setError(null);
              setHistory([]);
              setActiveToken(token);
            }}
            disabled={!token || token === activeToken}
            className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
          >
            Apply token
          </button>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => run(true)}
              disabled={busy !== null || !token}
              className="flex-1 rounded-md border border-zinc-300 py-2 text-sm disabled:opacity-40 dark:border-zinc-700"
            >Preview</button>
            <button
              type="button"
              onClick={() => run(false)}
              disabled={busy !== null || !token}
              className="flex-1 rounded-md bg-zinc-900 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >Run payout</button>
          </div>
          <p role="status" className="mt-2 text-sm">
            {busy && <span className="text-zinc-500">{busy}</span>}
            {error && <span className="text-red-600">{error}</span>}
          </p>
        </section>
      </div>

      {history.length > 0 && (
        <section className="mt-6">
          <label htmlFor="payout-history" className="block text-sm font-medium">Saved payout batches</label>
          <select
            id="payout-history"
            value={selectedHistoryBatch?.id ?? ""}
            onChange={(e) => {
              setSelectedBatchId(e.target.value);
              setBatch(null);
            }}
            className="mt-2 w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
          >
            {history.map((b) => (
              <option key={b.id} value={b.id}>
                {new Date(b.createdAt).toLocaleString()} — {b.mode} — {b.status} — {formatCents(batchTotalCents(b))}
              </option>
            ))}
          </select>
        </section>
      )}

      {displayedBatch && (
        <section aria-label="Payout batch" className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{displayedBatch.dryRun ? "Preview (nothing was paid)" : "Payout batch"}</h2>
            {displayedBatch.b.mode === "simulated" && <SimulatedBadge />}
            {!displayedBatch.dryRun && displayedBatch.b.status !== "SIMULATED" && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{displayedBatch.b.status}</span>
            )}
          </div>
          {displayedBatch.b.items.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No cause has reached the {formatCents(displayedBatch.b.thresholdCents)} threshold yet, so there&apos;s nothing to pay out.
            </p>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {displayedBatch.b.items.map((i) => (
                  <li key={i.causeId} className="flex justify-between gap-4 py-2">
                    <span>
                      {causeName(i.causeId)}
                      <span className="block text-xs text-zinc-500">
                        {i.receiver} · {i.ledgerEntryIds.length} {i.ledgerEntryIds.length === 1 ? "donation" : "donations"}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatCents(i.amountCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-zinc-200 pt-2 text-sm font-semibold dark:border-zinc-800">
                <span>Total</span>
                <span className="tabular-nums">{formatCents(batchTotalCents(displayedBatch.b))}</span>
              </div>
            </>
          )}
          {!displayedBatch.dryRun && displayedBatch.b.items.length > 0 && (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-zinc-500">
              <dt>Batch</dt>
              <dd className="break-all font-mono">{displayedBatch.b.senderBatchId}</dd>
              <dt>PayPal batch</dt>
              <dd className="break-all font-mono">{displayedBatch.b.paypalPayoutBatchId ?? "none (simulated)"}</dd>
            </dl>
          )}
          {!displayedBatch.dryRun && canRefresh(displayedBatch.b) && (
            <button
              type="button"
              onClick={() => refresh(displayedBatch.b.id)}
              disabled={busy !== null}
              className="mt-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
            >Refresh status</button>
          )}
        </section>
      )}
    </main>
  );
}

function SimulatedBadge() {
  return (
    <span
      title="PAYOUT_MODE=simulated: no money moves. Ledger entries are marked as simulated payouts."
      className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >SIMULATED</span>
  );
}
