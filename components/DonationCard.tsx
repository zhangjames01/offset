"use client";

import { useState } from "react";
import type { ClassifyResponse } from "@/contracts";
import { formatCents } from "@/lib/cart";
import { adjustmentNote, applyEdit, CATEGORY_LABEL, defaultDecision, type Decision } from "@/lib/donation";

type Props = {
  classification: ClassifyResponse;
  decision: Decision;
  maxCents: number;
  onChange: (d: Decision) => void;
};

export function DonationCard({ classification: c, decision, maxCents, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const note = adjustmentNote(c);
  const removed = decision.action === "removed";
  const none = !removed && decision.cents === 0; // e.g. opted_out: nothing suggested

  function startEdit() {
    setText((decision.cents / 100).toFixed(2));
    setError(null);
    setEditing(true);
  }

  function saveEdit() {
    const r = applyEdit(c, text, maxCents);
    if (!r.ok) return setError(r.error);
    onChange(r.decision);
    setEditing(false);
  }

  return (
    <section
      aria-label="Suggested donation"
      className="rounded-lg border border-emerald-300 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">
          {CATEGORY_LABEL[c.category]}
        </span>
        {c.source === "rules" && <span className="text-zinc-500">rule-based fallback</span>}
      </div>

      <h2 className="mt-3 font-semibold">{c.causeName}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{c.reason}</p>

      <div className="mt-4 flex items-baseline justify-between">
        <span className={`text-2xl font-semibold tabular-nums ${removed ? "text-zinc-400 line-through" : ""}`}>
          {formatCents(removed ? c.donationCents : decision.cents)}
        </span>
        <span className="text-xs text-zinc-500">Rate: {c.rateRule}</span>
      </div>
      {note && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{note}</p>}
      {decision.action === "edited" && (
        <p className="mt-1 text-xs text-zinc-500">You changed this from {formatCents(c.donationCents)}.</p>
      )}

      {editing ? (
        <div className="mt-4">
          <label htmlFor="donation-amount" className="text-sm">
            Amount (up to {formatCents(maxCents)})
          </label>
          <div className="mt-1 flex gap-2">
            <span className="self-center">$</span>
            <input
              id="donation-amount"
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
              aria-invalid={error !== null}
              aria-describedby={error ? "donation-error" : undefined}
              className="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 tabular-nums dark:border-zinc-700"
            />
            <button type="button" onClick={saveEdit} className="rounded-md bg-zinc-900 px-3 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="px-2 text-sm text-zinc-500">
              Cancel
            </button>
          </div>
          {error && (
            <p id="donation-error" role="alert" className="mt-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex gap-2 text-sm">
          {decision.action !== "accepted" || removed ? (
            <button type="button" onClick={() => onChange(defaultDecision(c))} className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
              {removed ? "Add donation back" : "Use suggested"}
            </button>
          ) : (
            <span className="self-center px-1 text-emerald-700 dark:text-emerald-400">{none ? "No donation" : "✓ Included"}</span>
          )}
          {maxCents > 0 && (
            <button type="button" onClick={startEdit} className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
              {none ? "Add an amount" : "Edit"}
            </button>
          )}
          {!removed && !none && (
            <button type="button" onClick={() => onChange({ action: "removed", cents: 0 })} className="px-3 py-1.5 text-zinc-500 hover:text-red-600">
              Remove
            </button>
          )}
        </div>
      )}
    </section>
  );
}
