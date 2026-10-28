// POST /api/checkout/capture — owner: Jay (J4). Captures the order, writes the LedgerEntry.
import { CaptureRequest, CaptureResponse, DEFAULT_CAUSE } from "@/contracts";
import type { Category } from "@/contracts";
import { ApiFailure, handle, modes, notImplemented, ok, parseBody } from "@/lib/api";
import { mockCapture, mockCauses, mockCreateOrder } from "@/lib/mocks";
import { nextId, store } from "@/lib/mock-store";

export const POST = handle(async (req: Request) => {
  const { paypalOrderId } = await parseBody(req, CaptureRequest);

  if (modes.paypal() !== "mock") notImplemented("PayPal sandbox capture", "J4");

  const s = store();
  const order = s.orders.get(paypalOrderId);
  if (!order) {
    // The canned order ID from mocks/paypal works without calling create-order first.
    if (paypalOrderId === mockCreateOrder.paypalOrderId) {
      return ok(CaptureResponse, mockCapture);
    }
    throw new ApiFailure("NOT_FOUND", `Unknown paypalOrderId: ${paypalOrderId}`, 404);
  }

  // Idempotent: a second capture returns the first result, no second ledger row.
  if (order.captured) {
    return ok(CaptureResponse, {
      status: "COMPLETED",
      localOrderId: order.localOrderId,
      ledgerEntryId: order.captured.ledgerEntryId,
    });
  }

  let ledgerEntryId: string | null = null;
  const { donation } = order;
  if (donation.userAction !== "removed" && donation.donationCents > 0) {
    const cls = s.classifications.get(donation.classificationId);
    const category: Category =
      cls?.category ??
      (Object.keys(DEFAULT_CAUSE) as Category[]).find((c) => DEFAULT_CAUSE[c] === donation.causeId) ??
      mockCauses.find((c) => c.id === donation.causeId)?.categories[0] ??
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
  return ok(CaptureResponse, { status: "COMPLETED", localOrderId: order.localOrderId, ledgerEntryId });
});
