"use client";

import { useEffect, useState } from "react";
import { LoadError } from "./LoadError";
import { ApiError, Category, Preferences, type CauseId } from "@/contracts";
import { CATEGORY_LABEL } from "@/lib/donation";
import {
  centsToDollars,
  finalizeDraft,
  toDraft,
  toggle,
  type CapText,
  type Draft,
  type DraftErrors,
} from "@/lib/preferences";

type Props = { causes: { id: CauseId; name: string }[] };
type Status = { kind: "idle" } | { kind: "unsaved" } | { kind: "busy"; what: string } | { kind: "saved"; at: string } | { kind: "error"; message: string };

async function send(method: "POST" | "PUT", url: string, body: unknown): Promise<Preferences> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw new Error(err.success ? err.data.error.message : `Request failed (${res.status})`);
  }
  return Preferences.parse(json);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export function PreferencesEditor({ causes }: Props) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  // The text the chips were last loaded, parsed or saved from. Saving edited text with old chips
  // would store a mismatch, so Save waits until the new text is parsed.
  const [parsedText, setParsedText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [caps, setCaps] = useState<CapText>({ monthly: "", perOrder: "" });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function show(p: Preferences) {
    setParsedText(p.rawText);
    setDraft(toDraft(p));
    setCaps({ monthly: centsToDollars(p.monthlyCapCents), perOrder: centsToDollars(p.perOrderMaxCents) });
    setErrors({});
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/preferences")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Couldn't load preferences (${r.status})`);
        return Preferences.parse(await r.json());
      })
      .then((p) => {
        if (cancelled) return;
        setText(p.rawText);
        show(p);
      })
      .catch((e: unknown) => !cancelled && setLoadError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function edit(next: Partial<Draft>) {
    if (!draft) return;
    setDraft({ ...draft, ...next });
    setStatus({ kind: "unsaved" });
  }

  async function parse() {
    setStatus({ kind: "busy", what: "Reading your preferences…" });
    try {
      show(await send("POST", "/api/preferences/parse", { rawText: text }));
      setStatus({ kind: "unsaved" });
    } catch (e) {
      setStatus({ kind: "error", message: errMsg(e) });
    }
  }

  async function save() {
    if (!draft) return;
    const r = finalizeDraft({ ...draft, rawText: parsedText }, caps);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setStatus({ kind: "busy", what: "Saving…" });
    try {
      const saved = await send("PUT", "/api/preferences", r.draft);
      show(saved);
      setStatus({ kind: "saved", at: saved.updatedAt });
    } catch (e) {
      setStatus({ kind: "error", message: errMsg(e) });
    }
  }

  const busy = status.kind === "busy";
  const textChanged = draft !== null && text !== parsedText;

  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Giving preferences</h1>
      <p className="mt-1 text-sm text-zinc-500">Tell us what you care about. We&apos;ll match checkout donations to it.</p>

      {loadError && (
        <div className="mt-6">
          <LoadError
            message="Couldn't load your preferences. Check your connection and try again."
            onRetry={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
          />
        </div>
      )}

      <label htmlFor="pref-text" className="mt-6 block text-sm font-medium">
        In your own words
      </label>
      <textarea
        id="pref-text"
        rows={3}
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="I care about climate and hunger. Max $15 a month, skip packaging."
        className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
      />
      <button
        type="button"
        onClick={parse}
        disabled={busy || !text.trim()}
        className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
      >
        Update from text
      </button>

      {!draft && !loadError && <p className="mt-6 text-zinc-500">Loading…</p>}
      {draft && (
        <div className="mt-8 space-y-6">
          <ChipGroup
            title="Causes I support"
            error={errors.causes}
            options={causes.map((c) => ({ value: c.id, label: c.name.replace(/ \(placeholder partner\)$/, "") }))}
            selected={draft.causes}
            disabled={busy}
            onToggle={(id) => edit({ causes: toggle(draft.causes, id) })}
          />
          <ChipGroup
            title="Don't suggest donations for"
            options={Category.options.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
            selected={draft.optOutCategories}
            disabled={busy}
            onToggle={(c) => edit({ optOutCategories: toggle(draft.optOutCategories, c) })}
            tone="muted"
          />
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Limits</legend>
            <MoneyField id="cap-monthly" label="Monthly cap" value={caps.monthly} error={errors.monthly} onChange={(v) => { setCaps({ ...caps, monthly: v }); edit({}); }} />
            <MoneyField id="cap-order" label="Max per order" value={caps.perOrder} error={errors.perOrder} onChange={(v) => { setCaps({ ...caps, perOrder: v }); edit({}); }} />
          </fieldset>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || textChanged}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save preferences
            </button>
            <span role="status" className="text-sm">
              {status.kind === "busy" && <span className="text-zinc-500">{status.what}</span>}
              {status.kind !== "busy" && textChanged && (
                <span className="text-amber-700 dark:text-amber-400">
                  Text changed. Click &quot;Update from text&quot; first, or{" "}
                  <button type="button" onClick={() => setText(parsedText)} className="underline">
                    undo the text change
                  </button>
                  .
                </span>
              )}
              {status.kind === "unsaved" && !textChanged && <span className="text-amber-700 dark:text-amber-400">Review the choices below, then save</span>}
              {status.kind === "saved" && <span className="text-emerald-700 dark:text-emerald-400">✓ Saved</span>}
              {status.kind === "error" && <span className="text-red-600">{status.message}</span>}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

function ChipGroup<T extends string>(props: {
  title: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (v: T) => void;
  error?: string;
  tone?: "muted";
  disabled?: boolean;
}) {
  const on = props.tone === "muted"
    ? "border-zinc-500 bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900"
    : "border-emerald-600 bg-emerald-600 text-white";
  return (
    <fieldset disabled={props.disabled}>
      <legend className="text-sm font-medium">{props.title}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.options.map((o) => {
          const pressed = props.selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => props.onToggle(o.value)}
              className={`rounded-full border px-3 py-1 text-sm disabled:opacity-50 ${pressed ? on : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
            >
              {pressed ? "✓ " : ""}
              {o.label}
            </button>
          );
        })}
      </div>
      {props.error && <p className="mt-1 text-xs text-red-600">{props.error}</p>}
    </fieldset>
  );
}

function MoneyField(props: { id: string; label: string; value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={props.id} className="text-sm">
        {props.label}
      </label>
      <div className="mt-1 flex items-center gap-1">
        <span>$</span>
        <input
          id={props.id}
          inputMode="decimal"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={Boolean(props.error)}
          className="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 tabular-nums dark:border-zinc-700"
        />
      </div>
      {props.error && <p className="mt-1 text-xs text-red-600">{props.error}</p>}
    </div>
  );
}
