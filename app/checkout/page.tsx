import type { Metadata } from "next";
import { Checkout } from "@/components/Checkout";
import { modes } from "@/lib/api";

export const metadata: Metadata = { title: "Checkout · Offset" };

export default function CheckoutPage() {
  // PAYPAL_MODE is server-only; pass it down. The client ID is public by design.
  const pay = { mode: modes.paypal(), clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "" };
  return <Checkout pay={pay} />;
}
