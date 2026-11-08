import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Checkout } from "@/components/Checkout";
import { modes } from "@/lib/api";

export const metadata: Metadata = { title: "Checkout · Offset" };

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-5xl p-4 text-zinc-500 sm:p-8">Loading checkout…</p>}>
      <CheckoutWithPayConfig />
    </Suspense>
  );
}

// Read PAYPAL_MODE per request, like the checkout API routes. Without connection() the page is
// prerendered and the mode is frozen at build time, so the page and the API could disagree.
async function CheckoutWithPayConfig() {
  await connection();
  const pay = { mode: modes.paypal(), clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "" };
  return <Checkout pay={pay} />;
}
