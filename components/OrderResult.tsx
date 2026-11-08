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

export function PaymentFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section role="alert" className="rounded-lg border border-red-300 p-6 dark:border-red-900">
      <h2 className="text-xl font-semibold">Payment didn&apos;t go through</h2>
      <p className="mt-2 text-sm text-red-600">{message}</p>
      <p className="mt-2 text-sm text-zinc-500">You weren&apos;t charged. Your cart is still saved.</p>
      <button type="button" onClick={onRetry} className="mt-6 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
        Back to checkout
      </button>
    </section>
  );
}
