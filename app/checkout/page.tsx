import type { Metadata } from "next";
import { Checkout } from "@/components/Checkout";

export const metadata: Metadata = { title: "Checkout · Offset" };

export default function CheckoutPage() {
  return <Checkout />;
}
