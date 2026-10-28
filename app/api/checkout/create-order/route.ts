// POST /api/checkout/create-order — owner: Jay (J3). Builds the PayPal order.
import { CreateOrderRequest, CreateOrderResponse } from "@/contracts";
import { ApiFailure, handle, modes, notImplemented, ok, parseBody } from "@/lib/api";
import { mockCatalog } from "@/lib/mocks";
import { nextId, store } from "@/lib/mock-store";

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateOrderRequest);

  // Same checks the real route must do: re-price from the catalog, re-check caps.
  const prices = new Map(mockCatalog.products.map((p) => [p.id, p.priceCents]));
  for (const item of body.items) {
    if (!prices.has(item.productId)) {
      throw new ApiFailure("VALIDATION_ERROR", `Unknown productId: ${item.productId}`, 400);
    }
  }
  const s = store();
  const donationCents = body.donation.userAction === "removed" ? 0 : body.donation.donationCents;
  if (donationCents > s.preferences.perOrderMaxCents) {
    throw new ApiFailure(
      "VALIDATION_ERROR",
      `Donation ${donationCents}¢ exceeds the per-order max of ${s.preferences.perOrderMaxCents}¢`,
      400,
    );
  }

  if (modes.paypal() !== "mock") notImplemented("PayPal sandbox create-order", "J3");

  const paypalOrderId = nextId("MOCKORDER");
  const localOrderId = nextId("ord_mock_");
  s.orders.set(paypalOrderId, {
    paypalOrderId,
    localOrderId,
    donation: { ...body.donation, donationCents },
    captured: null,
  });
  return ok(CreateOrderResponse, { paypalOrderId, localOrderId }, 201);
});
