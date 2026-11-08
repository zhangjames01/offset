import Link from "next/link";
import { formatCents } from "@/lib/cart";

export type Receipt = {
  localOrderId: string;
  ledgerEntryId: string | null;
  totalCents: number;
  donationCents: number;
  causeName: string;
};

export function PaymentSuccess({ r }: { r: Receipt }) {
  return (
    <section className="rounded-lg border border-emerald-300 p-6 dark:border-emerald-900">
      <h2 className="text-xl font-semibold">Payment complete</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Order {r.localOrderId} · {formatCents(r.totalCents)} charged
      </p>
      {r.ledgerEntryId ? (
        <p className="mt-4">
          {formatCents(r.donationCents)} is going to <strong>{r.causeName}</strong>. Thank you!
        </p>
      ) : (
        <p className="mt-4 text-zinc-500">No donation on this order.</p>
      )}
      <Link href="/" className="mt-6 inline-block text-sm underline">
        Back to store
      </Link>
    </section>
  );
}

export function PaymentFailure(props: {
  message: string;
  /** true when PayPal approved but our capture failed: the buyer may already be charged. */
  captureFailed: boolean;
  busy: boolean;
  /** For a failed capture, only offered after "Try again" has failed once: starting over drops the approved order. */
  canStartOver: boolean;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  return (
    <section role="alert" className="rounded-lg border border-red-300 p-6 dark:border-red-900">
      <h2 className="text-xl font-semibold">{props.captureFailed ? "We couldn't confirm your payment" : "Payment didn't go through"}</h2>
      <p className="mt-2 text-sm text-red-600">{props.message}</p>
      <p className="mt-2 text-sm text-zinc-500">
        {props.captureFailed
          ? "PayPal may already have taken the payment. Try again to confirm this same order. You won't be charged twice."
          : "You weren't charged. Your cart is still saved."}
      </p>
      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={props.onRetry}
          disabled={props.busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {props.busy ? "Trying again…" : props.captureFailed ? "Try again" : "Back to checkout"}
        </button>
        {props.captureFailed && props.canStartOver && (
          <button type="button" onClick={props.onStartOver} className="text-sm text-zinc-500 underline">
            Cancel and start a new order
          </button>
        )}
      </div>
      {props.captureFailed && props.canStartOver && (
        <p className="mt-3 text-xs text-zinc-500">
          Only start a new order if your PayPal account shows no payment for this one, or you may be charged twice.
        </p>
      )}
    </section>
  );
}
