import { z } from "zod";
import { CauseId, Cents, UserAction } from "./common";

/** POST /api/checkout/create-order body. Server re-prices from the catalog and re-checks caps. */
export const CreateOrderRequest = z.object({
  cartId: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.int().positive(),
      }),
    )
    .min(1),
  donation: z.object({
    classificationId: z.string().min(1),
    donationCents: Cents,
    causeId: CauseId,
    userAction: UserAction,
  }),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

export const CreateOrderResponse = z.object({
  paypalOrderId: z.string().min(1),
  localOrderId: z.string().min(1),
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;

/** POST /api/checkout/capture body. Capturing twice returns the same result (no double ledger write). */
export const CaptureRequest = z.object({
  paypalOrderId: z.string().min(1),
});
export type CaptureRequest = z.infer<typeof CaptureRequest>;

export const CaptureResponse = z.object({
  status: z.literal("COMPLETED"),
  localOrderId: z.string().min(1),
  /** null when the donation was removed. */
  ledgerEntryId: z.string().min(1).nullable(),
});
export type CaptureResponse = z.infer<typeof CaptureResponse>;
