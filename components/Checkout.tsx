"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, ClassifyResponse, Preferences } from "@/contracts";
import { formatCents, subtotalCents, toClassifyRequest } from "@/lib/cart";
import { defaultDecision, donationCents, maxEditCents, type Decision } from "@/lib/donation";
import { useCart } from "./CartProvider";
import { DonationCard } from "./DonationCard";

type Result = { key: string } & ({ ok: true; data: ClassifyResponse } | { ok: false; message: string });

async function postJson<T>(url: string, body: unknown, schema: { parse: (v: unknown) => T }): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw new Error(err.success ? err.data.error.message : `Request failed (${res.status})`);
  }
  return schema.parse(json);
}

export function Checkout() {
  const { cart, ready } = useCart();
  const request = useMemo(() => (cart.lines.length ? toClassifyRequest(cart) : null), [cart]);
  const key = request ? JSON.stringify(request) : "";

  const [result, setResult] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);
  const [perOrderMax, setPerOrderMax] = useState<number | null>(null);
  // Keyed by classificationId so a re-classified cart starts back at the suggestion.
  const [decision, setDecision] = useState<{ id: string; d: Decision } | null>(null);

  useEffect(() => {
    if (!ready || !request) return;
    let cancelled = false;
    postJson("/api/classify", request, ClassifyResponse)
      .then((data) => !cancelled && setResult({ key, ok: true, data }))
      .catch((e: unknown) => {
        if (!cancelled) setResult({ key, ok: false, message: e instanceof Error ? e.message : "Classify failed" });
      });
    return () => {
      cancelled = true;
    };
    // key captures every field of request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, retry]);

  // Edit bound only. If this fails the card falls back to the suggested amount as the max.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/preferences")
      .then(async (r) => (r.ok ? Preferences.parse(await r.json()) : null))
      .then((p) => !cancelled && p && setPerOrderMax(p.perOrderMaxCents))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return <Shell><p className="text-zinc-500">Loading cart…</p></Shell>;
  if (!request) {
    return (
      <Shell>
        <p className="text-zinc-500">Your cart is empty.</p>
        <BackLink />
      </Shell>
    );
  }

  const current = result?.key === key ? result : null;
  const classification = current?.ok ? current.data : null;
  const d =
    classification && decision?.id === classification.classificationId
      ? decision.d
      : classification
        ? defaultDecision(classification)
        : null;
  const subtotal = subtotalCents(cart);
  const donation = d ? donationCents(d) : 0;

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">Order</h2>
            <ul className="mt-3 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {cart.lines.map(({ product, quantity }) => (
                <li key={product.id} className="flex justify-between gap-4 py-2">
                  <span>
                    {product.name} <span className="text-zinc-500">× {quantity}</span>
                  </span>
                  <span className="tabular-nums">{formatCents(product.priceCents * quantity)}</span>
                </li>
              ))}
            </ul>
          </section>

          {!current && <p className="text-sm text-zinc-500">Finding a matching cause…</p>}
          {current && !current.ok && (
            <div className="rounded-lg border border-red-200 p-4 text-sm dark:border-red-900">
              <p className="text-red-600">Couldn&apos;t suggest a donation: {current.message}</p>
              <button type="button" onClick={() => setRetry((n) => n + 1)} className="mt-2 underline">
                Try again
              </button>
            </div>
          )}
          {classification && d && (
            <DonationCard
              classification={classification}
              decision={d}
              maxCents={maxEditCents(classification, perOrderMax)}
              onChange={(next) => setDecision({ id: classification.classificationId, d: next })}
            />
          )}
        </div>

        <aside className="h-fit rounded-lg border border-zinc-200 p-4 text-sm lg:sticky lg:top-8 dark:border-zinc-800">
          <Row label="Subtotal" cents={subtotal} />
          <Row label="Donation" cents={donation} />
          <div className="mt-3 border-t border-zinc-200 pt-3 font-semibold dark:border-zinc-800">
            <Row label="Total" cents={subtotal + donation} />
          </div>
          {/* TODO(H4): PayPal buttons. Send toCreateOrderRequest(cart, classification, d) to create-order. */}
          <button
            type="button"
            disabled
            className="mt-4 w-full rounded-md bg-zinc-900 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Pay with PayPal
          </button>
          <BackLink />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-8">
      <h1 className="mb-6 text-2xl font-semibold">Checkout</h1>
      {children}
    </main>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between py-0.5">
      <span>{label}</span>
      <span className="tabular-nums">{formatCents(cents)}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/" className="mt-3 block text-center text-sm text-zinc-500 underline">
      Back to store
    </Link>
  );
}
