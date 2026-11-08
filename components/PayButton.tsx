"use client";

import { useState } from "react";
import { PayPalOneTimePaymentButton, PayPalProvider } from "@paypal/react-paypal-js/sdk-v6";
import type { CaptureResponse, CreateOrderRequest } from "@/contracts";
import { captureOrder, createOrder } from "@/lib/checkout-api";

type Props = {
  mode: "mock" | "sandbox";
  clientId: string;
  /** null while the donation isn't ready (still classifying, or classify failed). */
  request: CreateOrderRequest | null;
  onPaid: (r: CaptureResponse) => void;
  onFailed: (message: string) => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : "Payment failed");

export function PayButton({ mode, clientId, request, onPaid, onFailed }: Props) {
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  if (mode === "mock") {
    // PAYPAL_MODE=mock: no PayPal popup, same create-order → capture calls.
    async function payMock() {
      if (!request) return;
      setBusy(true);
      try {
        const { paypalOrderId } = await createOrder(request);
        onPaid(await captureOrder(paypalOrderId));
      } catch (e) {
        onFailed(message(e));
      } finally {
        setBusy(false);
      }
    }
    return (
      <div>
        <button
          type="button"
          onClick={payMock}
          disabled={!request || busy}
          className="w-full rounded-md bg-[#ffc439] py-2 font-medium text-zinc-900 hover:brightness-95 disabled:opacity-40"
        >
          {busy ? "Processing…" : "Pay with PayPal"}
        </button>
        <p className="mt-1 text-center text-xs text-zinc-500">Mock mode: no real PayPal popup</p>
      </div>
    );
  }

  if (!clientId) {
    return <p className="text-sm text-red-600">Set NEXT_PUBLIC_PAYPAL_CLIENT_ID in .env.local to use sandbox mode.</p>;
  }

  return (
    <PayPalProvider clientId={clientId} environment="sandbox" components={["paypal-payments"]} pageType="checkout">
      <PayPalOneTimePaymentButton
        disabled={!request}
        createOrder={async () => {
          if (!request) throw new Error("Donation not ready");
          setCancelled(false);
          const { paypalOrderId } = await createOrder(request);
          return { orderId: paypalOrderId };
        }}
        onApprove={async ({ orderId }) => {
          try {
            onPaid(await captureOrder(orderId));
          } catch (e) {
            onFailed(message(e));
          }
        }}
        onCancel={() => setCancelled(true)}
        onError={(e) => onFailed(message(e))}
      />
      {cancelled && <p className="mt-1 text-center text-xs text-zinc-500">Payment cancelled. Your cart is still here.</p>}
    </PayPalProvider>
  );
}
