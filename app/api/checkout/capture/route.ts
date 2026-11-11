
// POST /api/checkout/capture — owner: Jay (J4).
// Captures the PayPal order and records the donation in the ledger.

import { CaptureRequest, CaptureResponse, DEFAULT_CAUSE } from "@/contracts";
import type { Category } from "@/contracts";
import {
  ApiFailure,
  handle,
  modes,
  ok,
  parseBody,
} from "@/lib/api";
import { mockCapture, mockCauses, mockCreateOrder } from "@/lib/mocks";
import { nextId, store } from "@/lib/mock-store";
import { getPrisma } from "@/lib/db";
import {
  capturePayPalOrder,
  getPayPalOrder,
} from "@/lib/paypal/client";

// --------------------------------------------
// PayPal Sandbox capture
// --------------------------------------------

async function captureSandboxOrder(paypalOrderId: string) {
  const prisma = getPrisma();

  const order = await prisma.order.findUnique({
    where: { paypalOrderId },
  });

  if (!order) {
    throw new ApiFailure(
      "NOT_FOUND",
      "PayPal order not found",
      404,
    );
  }

  // Already completed: return the saved result.
  if (order.status === "COMPLETED") {
    const ledger = await prisma.ledgerEntry.findUnique({
      where: { localOrderId: order.id },
    });

    return ok(CaptureResponse, {
      status: "COMPLETED",
      localOrderId: order.id,
      ledgerEntryId: ledger?.id ?? null,
    });
  }

  // A previous request may have captured the payment
  // but failed before updating Neon.
  if (order.status === "CAPTURING") {
    let existingCapture;

    try {
      existingCapture = await getPayPalOrder(paypalOrderId);
    } catch (error) {
      console.error("[paypal] recovery lookup failed", error);

      throw new ApiFailure(
        "CHECKOUT_CONFLICT",
        "Payment status is being verified. Please retry shortly.",
        409,
      );
    }

    const expectedTotalCents =
      order.purchaseCents + order.donationCents;

    if (
      existingCapture.status === "COMPLETED" &&
      existingCapture.captureStatus === "COMPLETED" &&
      existingCapture.captureId &&
      existingCapture.amountCents === expectedTotalCents
    ) {
      return finalizeAndRespond(
        order.id,
        paypalOrderId,
        {
          captureId: existingCapture.captureId,
          amountCents: existingCapture.amountCents,
        },
      );
    }

    // Never recapture while the outcome is uncertain.
    throw new ApiFailure(
      "CHECKOUT_CONFLICT",
      "Payment capture is in progress or requires reconciliation.",
      409,
    );
  }

  // Only a CREATED order can start a new capture.
  if (order.status !== "CREATED") {
    throw new ApiFailure(
      "CHECKOUT_CONFLICT",
      "Order is not ready for payment capture.",
      409,
    );
  }

  // Atomically claim the order before contacting PayPal.
  const claim = await prisma.order.updateMany({
    where: {
      id: order.id,
      status: "CREATED",
    },
    data: {
      status: "CAPTURING",
    },
  });

  if (claim.count !== 1) {
    throw new ApiFailure(
      "CHECKOUT_CONFLICT",
      "Payment capture is already being processed.",
      409,
    );
  }

  // Contact PayPal Sandbox.
  let capture;

  try {
    capture = await capturePayPalOrder(paypalOrderId);
  } catch (error) {
    console.error("[paypal] capture failed", error);

    // Keep CAPTURING until PayPal's outcome is known.
    throw new ApiFailure(
      "PAYPAL_CAPTURE_FAILED",
      "Unable to capture PayPal payment",
      502,
    );
  }

  // Verify the captured amount.
  const expectedTotalCents =
    order.purchaseCents + order.donationCents;

  if (
    capture.status !== "COMPLETED" ||
    capture.currencyCode !== "USD" ||
    capture.amountCents !== expectedTotalCents
  ) {
    console.error("[paypal] capture amount mismatch", {
      paypalOrderId,
      expectedTotalCents,
      capturedAmountCents: capture.amountCents,
    });

    throw new ApiFailure(
      "PAYPAL_CAPTURE_FAILED",
      "PayPal captured amount does not match the order",
      502,
    );
  }

  return finalizeAndRespond(
    order.id,
    paypalOrderId,
    capture,
  );
}

// --------------------------------------------
// Finalization and concurrency recovery
// --------------------------------------------

type CaptureToFinalize = {
  captureId: string;
  amountCents: number;
};

async function finalizeAndRespond(
  orderId: string,
  paypalOrderId: string,
  capture: CaptureToFinalize,
) {
  const prisma = getPrisma();

  try {
    const result = await finalizeCapture(
      orderId,
      paypalOrderId,
      capture,
    );

    return ok(CaptureResponse, result);
  } catch (error) {
    // Another request may have completed the transaction.
    const completedOrder = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (
      completedOrder?.status === "COMPLETED" &&
      completedOrder.paypalCaptureId === capture.captureId
    ) {
      const ledger = await prisma.ledgerEntry.findUnique({
        where: { localOrderId: orderId },
      });

      return ok(CaptureResponse, {
        status: "COMPLETED",
        localOrderId: orderId,
        ledgerEntryId: ledger?.id ?? null,
      });
    }

    console.error("[paypal] finalization failed", error);

    throw new ApiFailure(
      "CHECKOUT_CONFLICT",
      "Payment was captured, but order finalization needs reconciliation.",
      409,
    );
  }
}

// --------------------------------------------
// Atomic Neon transaction
// --------------------------------------------

async function finalizeCapture(
  orderId: string,
  paypalOrderId: string,
  capture: CaptureToFinalize,
) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(
        "Order not found during capture finalization",
      );
    }

    if (order.paypalOrderId !== paypalOrderId) {
      throw new Error("PayPal order ID mismatch");
    }

    const expectedTotalCents =
      order.purchaseCents + order.donationCents;

    if (capture.amountCents !== expectedTotalCents) {
      throw new Error(
        "Captured amount does not match order total",
      );
    }

    // Idempotent finalization.
    if (order.status === "COMPLETED") {
      if (order.paypalCaptureId !== capture.captureId) {
        throw new Error(
          "Order completed with a different capture ID",
        );
      }

      const existingLedger =
        await tx.ledgerEntry.findUnique({
          where: { localOrderId: order.id },
        });

      return {
        status: "COMPLETED" as const,
        localOrderId: order.id,
        ledgerEntryId: existingLedger?.id ?? null,
      };
    }

    if (order.status !== "CAPTURING") {
      throw new Error(
        "Order is not awaiting capture finalization",
      );
    }

    // Validate metadata before writing anything.
    if (
      order.donationCents > 0 &&
      (!order.causeId ||
        !order.category ||
        !order.userAction ||
        !order.classificationSource)
    ) {
      throw new Error(
        "Captured order is missing donation metadata",
      );
    }

    // Conditional update prevents overwriting
    // a previously completed order.
    const updated = await tx.order.updateMany({
      where: {
        id: order.id,
        status: "CAPTURING",
        paypalCaptureId: null,
      },
      data: {
        status: "COMPLETED",
        paypalCaptureId: capture.captureId,
      },
    });

    if (updated.count !== 1) {
      throw new Error(
        "Capture finalization conflict",
      );
    }

    let ledgerEntryId: string | null = null;

    if (order.donationCents > 0) {
      const ledger = await tx.ledgerEntry.create({
        data: {
          userId: order.userId,
          localOrderId: order.id,
          paypalOrderId,
          paypalCaptureId: capture.captureId,
          category: order.category!,
          causeId: order.causeId!,
          amountCents: order.donationCents,
          userAction: order.userAction!,
          classificationSource:
            order.classificationSource!,
          status: "pending_payout",
        },
      });

      ledgerEntryId = ledger.id;
    }

    return {
      status: "COMPLETED" as const,
      localOrderId: order.id,
      ledgerEntryId,
    };
  });
}

// --------------------------------------------
// API route
// --------------------------------------------

export const POST = handle(async (req: Request) => {
  const { paypalOrderId } = await parseBody(
    req,
    CaptureRequest,
  );

  if (modes.paypal() === "sandbox") {
    return captureSandboxOrder(paypalOrderId);
  }

  // ------------------------------------------
  // Existing mock mode — unchanged behavior
  // ------------------------------------------

  const s = store();
  const order = s.orders.get(paypalOrderId);

  if (!order) {
    if (paypalOrderId === mockCreateOrder.paypalOrderId) {
      return ok(CaptureResponse, mockCapture);
    }

    throw new ApiFailure(
      "NOT_FOUND",
      `Unknown paypalOrderId: ${paypalOrderId}`,
      404,
    );
  }

  // Repeated mock captures return the first result.
  if (order.captured) {
    return ok(CaptureResponse, {
      status: "COMPLETED",
      localOrderId: order.localOrderId,
      ledgerEntryId: order.captured.ledgerEntryId,
    });
  }

  let ledgerEntryId: string | null = null;
  const { donation } = order;

  if (
    donation.userAction !== "removed" &&
    donation.donationCents > 0
  ) {
    const cls = s.classifications.get(
      donation.classificationId,
    );

    const category: Category =
      cls?.category ??
      (Object.keys(DEFAULT_CAUSE) as Category[]).find(
        (c) => DEFAULT_CAUSE[c] === donation.causeId,
      ) ??
      mockCauses.find(
        (c) => c.id === donation.causeId,
      )?.categories[0] ??
      "general";

    ledgerEntryId = nextId("led_mock_");

    s.ledger.unshift({
      id: ledgerEntryId,
      userId: s.preferences.userId,
      localOrderId: order.localOrderId,
      paypalOrderId,
      paypalCaptureId: nextId("MOCKCAPTURE"),
      category,
      causeId: donation.causeId,
      amountCents: donation.donationCents,
      userAction: donation.userAction,
      classificationSource: cls?.source ?? "llm",
      status: "pending_payout",
      payoutBatchId: null,
      createdAt: new Date().toISOString(),
    });
  }

  order.captured = { ledgerEntryId };

  return ok(CaptureResponse, {
    status: "COMPLETED",
    localOrderId: order.localOrderId,
    ledgerEntryId,
  });
});
