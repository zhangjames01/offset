"use client";

import { useState } from "react";
import {
  INSTANCE_LOADING_STATE,
  PayPalOneTimePaymentButton,
  PayPalProvider,
  usePayPal,
} from "@paypal/react-paypal-js/sdk-v6";
import type { CaptureResponse, CreateOrderRequest } from "@/contracts";
import { captureOrder, createOrder } from "@/lib/api-client";

type Props = {
  mode: "mock" | "sandbox";
  clientId: string;
  /** null while the donation isn't ready (still classifying, or classify failed). */
  request: CreateOrderRequest | null;
  onPaid: (r: CaptureResponse) => void;
  /** orderId is set when the buyer approved but capture failed: retry capture on that order, never a new one. */
  onFailed: (message: string, orderId?: string) => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : "Payment failed");

export function PayButton({ mode, clientId, request, onPaid, onFailed }: Props) {
  const [busy, setBusy] = useState(false);

  if (mode === "mock") {
    // PAYPAL_MODE=mock: no PayPal popup, same create-order → capture calls.
    async function payMock() {
      if (!request) return;
      setBusy(true);
      let orderId: string | undefined;
      try {
        orderId = (await createOrder(request)).paypalOrderId;
        onPaid(await captureOrder(orderId));
      } catch (e) {
        onFailed(message(e), orderId);
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
      <SandboxButton request={request} onPaid={onPaid} onFailed={onFailed} />
    </PayPalProvider>
  );
}

function SandboxButton({ request, onPaid, onFailed }: Pick<Props, "request" | "onPaid" | "onFailed">) {
  const { loadingStatus, error } = usePayPal();
  const [cancelled, setCancelled] = useState(false);

  // Without this, an SDK load failure (bad client ID, blocked script) looks like a dead button.
  if (loadingStatus === INSTANCE_LOADING_STATE.PENDING) {
    return <p className="text-center text-sm text-zinc-500">Loading PayPal…</p>;
  }
  if (loadingStatus === INSTANCE_LOADING_STATE.REJECTED) {
    return (
      <p role="alert" className="text-sm text-red-600">
        PayPal couldn&apos;t load{error?.message ? `: ${error.message.replace(/\.+$/, "")}` : ""}. Check your connection and
        NEXT_PUBLIC_PAYPAL_CLIENT_ID, then reload.
      </p>
    );
  }

  return (
    <>
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
            onFailed(message(e), orderId);
          }
        }}
        onCancel={() => setCancelled(true)}
        onError={(e) => onFailed(message(e))}
      />
      {cancelled && <p className="mt-1 text-center text-xs text-zinc-500">Payment cancelled. Your cart is still here.</p>}
    </>
  );
}
