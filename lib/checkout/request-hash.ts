
import { createHash } from "node:crypto";
import type { z } from "zod";
import { CreateOrderRequest } from "@/contracts";

type CheckoutRequest = z.infer<typeof CreateOrderRequest>;

export function hashCheckoutRequest(
  body: CheckoutRequest,
): string {
  const normalizedItems = body.items
    .map(({ productId, quantity }) => ({
      productId,
      quantity,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));

  const normalized = {
    cartId: body.cartId,
    items: normalizedItems,
    donation: {
      classificationId: body.donation.classificationId,
      causeId: body.donation.causeId,
      donationCents: body.donation.donationCents,
      userAction: body.donation.userAction,
    },
  };

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}
