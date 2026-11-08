"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClassifyResponse, type CaptureResponse } from "@/contracts";
import { formatCents, subtotalCents, toClassifyRequest } from "@/lib/cart";
import { captureOrder, postJson } from "@/lib/api-client";
import { defaultDecision, donationCents, maxEditCents, toCreateOrderRequest, type Decision } from "@/lib/donation";
import { useCart } from "./CartProvider";
import { DonationCard } from "./DonationCard";
import { PaymentFailure, PaymentSuccess, type Receipt } from "./OrderResult";
import { PayButton } from "./PayButton";

type Result = { key: string } & ({ ok: true; data: ClassifyResponse } | { ok: false; message: string });

type PayConfig = { mode: "mock" | "sandbox"; clientId: string };
type ReceiptDetails = Omit<Receipt, "localOrderId" | "ledgerEntryId">;
/** orderId: capture failed on an approved order, so "Try again" re-captures it instead of starting a new one. */
type Failure = { message: string; orderId: string | null; details: ReceiptDetails };

export function Checkout({ pay }: { pay: PayConfig }) {
  const { cart, ready, dispatch } = useCart();
  const request = useMemo(() => (cart.lines.length ? toClassifyRequest(cart) : null), [cart]);
  const key = request ? JSON.stringify(request) : "";

  const [result, setResult] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);
  // Keyed by the classify request (the whole cart), so any cart change resets to the suggestion.
  // Not by classificationId: mock ids are fixed per product and cache hits can reuse ids.
  const [decision, setDecision] = useState<{ key: string; d: Decision } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [retryingCapture, setRetryingCapture] = useState(false);

  // Next keeps this page mounted (hidden) when you navigate away, so a finished payment's
  // screen would still show on the next visit. Once the cart has items again, drop it.
  const [seenCart, setSeenCart] = useState(cart);
  if (cart !== seenCart) {
    setSeenCart(cart);
    if (cart.lines.length > 0) {
      setReceipt(null);
      // Keep a failed capture: dropping it would let the buyer pay for the same order twice.
      if (!failure?.orderId) setFailure(null);
    }
  }

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

  // Checked first: the cart is cleared on success.
  if (receipt) return <Shell><PaymentSuccess r={receipt} /></Shell>;
  function finish(r: CaptureResponse, details: ReceiptDetails) {
    setReceipt({ ...details, localOrderId: r.localOrderId, ledgerEntryId: r.ledgerEntryId });
    setFailure(null);
    dispatch({ type: "clear" });
  }

  function retryFailure(f: Failure) {
    if (!f.orderId) {
      // create-order failed: re-classify too, in case the limits changed (e.g. monthly room).
      setFailure(null);
      setRetry((n) => n + 1);
      return;
    }
    setRetryingCapture(true);
    captureOrder(f.orderId) // capture is idempotent, so this can't charge twice
      .then((r) => finish(r, f.details))
      .catch((e: unknown) => setFailure({ ...f, message: e instanceof Error ? e.message : "Capture failed" }))
      .finally(() => setRetryingCapture(false));
  }

  if (failure) {
    return (
      <Shell>
        <PaymentFailure
          message={failure.message}
          captureFailed={failure.orderId !== null}
          busy={retryingCapture}
          onRetry={() => retryFailure(failure)}
          onStartOver={() => setFailure(null)}
        />
      </Shell>
    );
  }
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
    classification && decision?.key === key
      ? decision.d
      : classification
        ? defaultDecision(classification)
        : null;
  const subtotal = subtotalCents(cart);
  const donation = d ? donationCents(d) : 0;
  // Display-only: the server re-prices, but both read the same catalog.
  const details: ReceiptDetails = { totalCents: subtotal + donation, donationCents: donation, causeName: classification?.causeName ?? "" };

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

          <div aria-live="polite" className="space-y-6">
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
                key={key}
                classification={classification}
                decision={d}
                maxCents={maxEditCents(classification)}
                onChange={(next) => setDecision({ key, d: next })}
              />
            )}
          </div>
        </div>

        <aside className="h-fit rounded-lg border border-zinc-200 p-4 text-sm lg:sticky lg:top-8 dark:border-zinc-800">
          <Row label="Subtotal" cents={subtotal} />
          <Row label="Donation" cents={donation} />
          <div className="mt-3 border-t border-zinc-200 pt-3 font-semibold dark:border-zinc-800">
            <Row label="Total" cents={subtotal + donation} />
          </div>
          <div className="mt-4">
            <PayButton
              mode={pay.mode}
              clientId={pay.clientId}
              request={classification && d ? toCreateOrderRequest(cart, classification, d) : null}
              onPaid={(r) => finish(r, details)}
              onFailed={(message, orderId) => setFailure({ message, orderId: orderId ?? null, details })}
            />
          </div>
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
