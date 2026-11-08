// POST /api/checkout/create-order — owner: Jay (J3). Builds the PayPal order.

import { randomUUID } from "node:crypto";
import { CreateOrderRequest, CreateOrderResponse } from "@/contracts";
import { ApiFailure, handle, modes, ok, parseBody } from "@/lib/api";
import { getPrisma } from "@/lib/db";
import { mockCatalog, mockPreferences } from "@/lib/mocks";
import { nextId, store } from "@/lib/mock-store";
import { createPayPalOrder } from "@/lib/paypal/client";
import { hashCart } from "@/lib/checkout/cart-hash";
import { hashCheckoutRequest } from "@/lib/checkout/request-hash";

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateOrderRequest);

  // Re-price every item using trusted catalog data.
  const prices = new Map(
    mockCatalog.products.map((p) => [p.id, p.priceCents]),
  );

  
  const paypalProducts = body.items.map((item) => {
    const product = mockCatalog.products.find(
      (p) => p.id === item.productId,
    );

    if (!product) {
      throw new ApiFailure(
        "VALIDATION_ERROR",
        `Unknown productId: ${item.productId}`,
        400,
      );
    }

    return {
      name: product.name,
      unitPriceCents: product.priceCents,
      quantity: item.quantity,
    };
  });


  let purchaseCents = 0;

  for (const item of body.items) {
    const price = prices.get(item.productId);

    if (price === undefined) {
      throw new ApiFailure(
        "VALIDATION_ERROR",
        `Unknown productId: ${item.productId}`,
        400,
      );
    }

    purchaseCents += price * item.quantity;
  }

  if (!Number.isSafeInteger(purchaseCents) || purchaseCents <= 0) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Invalid cart total",
      400,
    );
  }

  const donationCents =
    body.donation.userAction === "removed"
      ? 0
      : body.donation.donationCents;

  // Preserve the existing mock checkout behavior.
  if (modes.paypal() === "mock") {
    const s = store();

    if (donationCents > s.preferences.perOrderMaxCents) {
      throw new ApiFailure(
        "VALIDATION_ERROR",
        "Donation exceeds the per-order maximum",
        400,
      );
    }

    const paypalOrderId = nextId("MOCKORDER");
    const localOrderId = nextId("ord_mock_");

    s.orders.set(paypalOrderId, {
      paypalOrderId,
      localOrderId,
      donation: { ...body.donation, donationCents },
      captured: null,
    });

    return ok(
      CreateOrderResponse,
      { paypalOrderId, localOrderId },
      201,
    );
  }


  // Sandbox mode: validate classification against Neon.
  const prisma = getPrisma();
  const userId = mockPreferences.userId;

  const classification =
    await prisma.classificationApproval.findUnique({
      where: {
        id: body.donation.classificationId,
      },
    });

  if (!classification) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Classification not found. Please classify the cart again.",
      400,
    );
  }

  if (
    classification.userId !== userId ||
    classification.cartId !== body.cartId
  ) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Classification does not belong to this cart or user",
      400,
    );
  }

  // Build a fingerprint using trusted catalog prices.
  const trustedItems = body.items.map((item) => {
    const priceCents = prices.get(item.productId);

    if (priceCents === undefined) {
      throw new ApiFailure(
        "VALIDATION_ERROR",
        `Unknown productId: ${item.productId}`,
        400,
      );
    }

    return {
      productId: item.productId,
      quantity: item.quantity,
      priceCents,
    };
  });

  const cartHash = hashCart(trustedItems);

  if (classification.cartHash !== cartHash) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Cart has changed. Please classify again.",
      400,
    );
  }

  if (classification.causeId !== body.donation.causeId) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Donation cause does not match the classification",
      400,
    );
  }

  if (
    body.donation.userAction === "accepted" &&
    donationCents !== classification.donationCents
  ) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Accepted donation does not match the recommendation",
      400,
    );
  }

  if (
    body.donation.userAction === "removed" &&
    body.donation.donationCents !== 0
  ) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Removed donations must be zero",
      400,
    );
  }

  if (
    body.donation.userAction === "edited" &&
    donationCents <= 0
  ) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Edited donation must be positive",
      400,
    );
  }


  // For this demo, the classifier and checkout use the
  // same seeded demo user.
  const prefs = await prisma.preferences.findUnique({
    where: { userId },
  });

  if (!prefs) {
    throw new ApiFailure(
      "INTERNAL",
      "Demo preferences are not configured",
      500,
    );
  }

  if (donationCents > prefs.perOrderMaxCents) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Donation exceeds the per-order maximum",
      400,
    );
  }

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const giving = await prisma.ledgerEntry.aggregate({
    where: {
      userId,
      createdAt: { gte: monthStart },
    },
    _sum: { amountCents: true },
  });

  const alreadyGiven = giving._sum.amountCents ?? 0;
  const remaining = Math.max(
    0,
    prefs.monthlyCapCents - alreadyGiven,
  );

  if (donationCents > remaining) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Donation exceeds the remaining monthly allowance",
      400,
    );
  }

  // An accepted donation must match the recommendation.
  // Edited donations may be lower or higher within caps.
  if (
    body.donation.userAction === "accepted" &&
    donationCents !== classification.donationCents
  ) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Accepted donation does not match the recommendation",
      400,
    );
  }

  const totalCents = purchaseCents + donationCents;

  if (!Number.isSafeInteger(totalCents)) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      "Invalid payment total",
      400,
    );
  }



  const requestHash = hashCheckoutRequest(body);
  const proposedLocalOrderId = `ord_${randomUUID()}`;

  // Reserve the cart. Existing attempts are preserved.
  await prisma.checkoutAttempt.createMany({
    data: [{
      userId,
      cartId: body.cartId,
      requestHash,
      status: "PENDING",
      localOrderId: proposedLocalOrderId,
    }],
    skipDuplicates: true,
  });

  
const attempt = await prisma.checkoutAttempt.findUniqueOrThrow({
  where: {
    userId_cartId_requestHash: {
      userId,
      cartId: body.cartId,
      requestHash,
    },
  },
});

  if (attempt.status === "CREATED" && attempt.paypalOrderId) {
    return ok(
      CreateOrderResponse,
      {
        paypalOrderId: attempt.paypalOrderId,
        localOrderId: attempt.localOrderId,
      },
      200,
    );
  }

  // Claim a pending attempt atomically.
  // Only one request can transition PENDING -> PROCESSING.

  // Allow a retry if PROCESSING has been stale for 30 seconds.
  const staleBefore = new Date(Date.now() - 30_000);
  const processingToken = randomUUID();

  const claim = await prisma.checkoutAttempt.updateMany({
    where: {
      id: attempt.id,
      requestHash,
      OR: [
        { status: "PENDING" },
        {
          status: "PROCESSING",
          updatedAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      status: "PROCESSING",
      processingToken,
      updatedAt: new Date(),
    },
  });


  if (claim.count !== 1) {
  throw new ApiFailure(
    "CHECKOUT_CONFLICT",
    "Checkout is being processed. Please retry shortly.",
    409,
  );
}

  // Reuse this identifier for every retry.
  const localOrderId = attempt.localOrderId;

  let paypalOrderId: string;

  try {
    paypalOrderId = await createPayPalOrder(
    paypalProducts,
    donationCents,
    localOrderId,
  );
  } catch (error) {
    console.error("[paypal] create-order failed", error);

    // Allow a later retry using the same PayPal idempotency key.
    try {
      await prisma.checkoutAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "PROCESSING",
          processingToken,
        },
        data: {
          status: "PENDING",
          processingToken: null,
        },
      });
    } catch (recoveryError) {
      console.error(
        "[checkout] unable to release pending attempt",
        recoveryError,
      );
    }

    throw new ApiFailure(
      "PAYPAL_CREATE_FAILED",
      "Unable to create PayPal order",
      502,
    );
  }

  try {
    // Create the local order and mark the checkout complete
    // in the same database transaction.
    await prisma.$transaction(async (tx) => {
      const finalized = await tx.checkoutAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "PROCESSING",
          processingToken,
        },
        data: {
          status: "CREATED",
          paypalOrderId,
          processingToken: null,
        },
      });

      if (finalized.count !== 1) {
        throw new ApiFailure(
          "CHECKOUT_CONFLICT",
          "Checkout ownership changed. Please retry.",
          409,
        );
      }
      await tx.order.create({
        data: {
          id: localOrderId,
          userId,
          cartId: body.cartId,
          paypalOrderId,
          status: "CREATED",
          purchaseCents,
          donationCents,
          causeId:
            donationCents > 0 ? body.donation.causeId : null,
          category: classification.category,
          userAction: body.donation.userAction,
          classificationSource: classification.source,
          classificationId: classification.id,
          items: body.items,
        },
      });
    });
  } catch (error) {
    if (error instanceof ApiFailure) {
      throw error;
    }
    
    console.error("[checkout] order persistence failed", error);

    // The transaction rolls back both database writes.
    // The PayPal order may already exist.
    try {
      await prisma.checkoutAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "PROCESSING",
          processingToken,
        },
        data: {
          status: "PENDING",
          processingToken: null,
        },
      });
    } catch (recoveryError) {
      console.error(
        "[checkout] unable to release pending attempt",
        recoveryError,
      );
    }

    throw new ApiFailure(
      "INTERNAL",
      "Unable to save checkout order",
      500,
    );
  }

  return ok(
    CreateOrderResponse,
    { paypalOrderId, localOrderId },
    201,
  );
});
