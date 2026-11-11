import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/contracts";

// Mock the database before importing the API route.
const {
  findOrder,
  updateOrder,
  findLedger,
  createLedger,
  capturePayPal,
  getPayPal,
  transaction,
} = vi.hoisted(() => ({
  findOrder: vi.fn(),
  updateOrder: vi.fn(),
  findLedger: vi.fn(),
  createLedger: vi.fn(),
  capturePayPal: vi.fn(),
  getPayPal: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/server", () => ({
  connection: async () => {},
}));

vi.mock("@/lib/db", () => ({
  getPrisma: () => ({
    order: {
      findUnique: findOrder,
      updateMany: updateOrder,
    },
    ledgerEntry: {
      findUnique: findLedger,
      create: createLedger,
    },
    $transaction: transaction,
  }),
}));

vi.mock("@/lib/paypal/client", () => ({
  capturePayPalOrder: capturePayPal,
  getPayPalOrder: getPayPal,
}));

import { POST as capture } from "@/app/api/checkout/capture/route";

const post = (paypalOrderId: string) =>
  new Request("http://test/api/checkout/capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ paypalOrderId }),
  });

describe("PayPal Sandbox capture (J4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PAYPAL_MODE", "sandbox");
    findOrder.mockResolvedValue(null);
  });

  test("returns 404 when the PayPal order does not exist", async () => {
    const response = await capture(post("UNKNOWN123"));

    expect(response.status).toBe(404);

    const body = ApiError.parse(await response.json());

    expect(body.error.code).toBe("NOT_FOUND");
    expect(findOrder).toHaveBeenCalledWith({
      where: { paypalOrderId: "UNKNOWN123" },
    });
  });

  test("captures payment and creates a donation ledger entry", async () => {
    const order = {
      id: "order_123",
      userId: "demo-user",
      cartId: "cart_123",
      paypalOrderId: "PAYPAL123",
      paypalCaptureId: null as string | null,
      status: "CREATED" as string,
      purchaseCents: 2500,
      donationCents: 100,
      causeId: "carbon_removal",
      category: "air_travel",
      userAction: "accepted",
      classificationSource: "llm",
    };

    findOrder.mockImplementation(async () => ({ ...order }));

    updateOrder.mockImplementation(async ({ data }) => {
      if (data.status) {
        order.status = data.status;
      }

      if ("paypalCaptureId" in data) {
        order.paypalCaptureId = data.paypalCaptureId;
      }

      return { count: 1 };
    });

    capturePayPal.mockResolvedValue({
      status: "COMPLETED",
      captureId: "CAPTURE123",
      amountCents: 2600,
      currencyCode: "USD",
    });

    createLedger.mockResolvedValue({
      id: "ledger_123",
    });

    transaction.mockImplementation(async (callback) => {
      return callback({
        order: {
          findUnique: findOrder,
          updateMany: updateOrder,
        },
        ledgerEntry: {
          findUnique: findLedger,
          create: createLedger,
        },
      });
    });

    const response = await capture(post("PAYPAL123"));

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body).toEqual({
      status: "COMPLETED",
      localOrderId: "order_123",
      ledgerEntryId: "ledger_123",
    });

    expect(capturePayPal).toHaveBeenCalledTimes(1);

    expect(capturePayPal).toHaveBeenCalledWith("PAYPAL123");

    expect(createLedger).toHaveBeenCalledWith({
      data: expect.objectContaining({
        localOrderId: "order_123",
        paypalOrderId: "PAYPAL123",
        paypalCaptureId: "CAPTURE123",
        amountCents: 100,
        causeId: "carbon_removal",
        status: "pending_payout",
      }),
    });
  });

  test("repeated capture returns the existing result without charging again", async () => {
    const order = {
      id: "order_456",
      userId: "demo-user",
      cartId: "cart_456",
      paypalOrderId: "PAYPAL456",
      paypalCaptureId: null as string | null,
      status: "CREATED" as string,
      purchaseCents: 3000,
      donationCents: 200,
      causeId: "carbon_removal",
      category: "air_travel",
      userAction: "accepted",
      classificationSource: "llm",
    };

    findOrder.mockImplementation(async () => ({ ...order }));

    updateOrder.mockImplementation(async ({ data }) => {
      if (data.status) {
        order.status = data.status;
      }

      if ("paypalCaptureId" in data) {
        order.paypalCaptureId = data.paypalCaptureId;
      }

      return { count: 1 };
    });

    capturePayPal.mockResolvedValue({
      status: "COMPLETED",
      captureId: "CAPTURE456",
      amountCents: 3200,
      currencyCode: "USD",
    });

    createLedger.mockResolvedValue({
      id: "ledger_456",
    });

    findLedger.mockResolvedValue({
      id: "ledger_456",
    });

    transaction.mockImplementation(async (callback) => {
      return callback({
        order: {
          findUnique: findOrder,
          updateMany: updateOrder,
        },
        ledgerEntry: {
          findUnique: findLedger,
          create: createLedger,
        },
      });
    });

    // First request: capture the payment and create the ledger entry.
    const firstResponse = await capture(post("PAYPAL456"));

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual({
      status: "COMPLETED",
      localOrderId: "order_456",
      ledgerEntryId: "ledger_456",
    });

    // Second request: return the existing completed order.
    const secondResponse = await capture(post("PAYPAL456"));

    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({
      status: "COMPLETED",
      localOrderId: "order_456",
      ledgerEntryId: "ledger_456",
    });

    // PayPal should only be contacted once for capture.
    expect(capturePayPal).toHaveBeenCalledTimes(1);

    // Only one donation ledger entry should be created.
    expect(createLedger).toHaveBeenCalledTimes(1);

    // Both requests should return the same ledger entry.
    expect(findLedger).toHaveBeenCalledTimes(1);
  });

  test("recovers an already captured payment without capturing again", async () => {
    const order = {
      id: "order_recovery",
      userId: "demo-user",
      cartId: "cart_recovery",
      paypalOrderId: "PAYPALRECOVERY",
      paypalCaptureId: null as string | null,
      status: "CAPTURING" as string,
      purchaseCents: 4000,
      donationCents: 150,
      causeId: "carbon_removal",
      category: "air_travel",
      userAction: "accepted",
      classificationSource: "llm",
    };

    // Neon has not yet recorded the completed capture.
    findOrder.mockImplementation(async () => ({ ...order }));

    // PayPal confirms the payment was already captured.
    getPayPal.mockResolvedValue({
      status: "COMPLETED",
      captureId: "CAPTURERECOVERY",
      captureStatus: "COMPLETED",
      amountCents: 4150,
    });

    updateOrder.mockImplementation(async ({ data }) => {
      if (data.status) {
        order.status = data.status;
      }

      if ("paypalCaptureId" in data) {
        order.paypalCaptureId = data.paypalCaptureId;
      }

      return { count: 1 };
    });

    createLedger.mockResolvedValue({
      id: "ledger_recovery",
    });

    transaction.mockImplementation(async (callback) => {
      return callback({
        order: {
          findUnique: findOrder,
          updateMany: updateOrder,
        },
        ledgerEntry: {
          findUnique: findLedger,
          create: createLedger,
        },
      });
    });

    const response = await capture(post("PAYPALRECOVERY"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "COMPLETED",
      localOrderId: "order_recovery",
      ledgerEntryId: "ledger_recovery",
    });

    // Recovery reads PayPal's existing order.
    expect(getPayPal).toHaveBeenCalledExactlyOnceWith("PAYPALRECOVERY");

    // It must never attempt another payment capture.
    expect(capturePayPal).not.toHaveBeenCalled();

    // Donation is recorded exactly once.
    expect(createLedger).toHaveBeenCalledTimes(1);

    // Neon order is finalized with the original capture ID.
    expect(order.status).toBe("COMPLETED");
    expect(order.paypalCaptureId).toBe("CAPTURERECOVERY");
  });

  test("does not recapture a payment when PayPal status is uncertain", async () => {
    const order = {
      id: "order_uncertain",
      userId: "demo-user",
      cartId: "cart_uncertain",
      paypalOrderId: "PAYPALUNCERTAIN",
      paypalCaptureId: null,
      status: "CAPTURING",
      purchaseCents: 5000,
      donationCents: 200,
      causeId: "carbon_removal",
      category: "air_travel",
      userAction: "accepted",
      classificationSource: "llm",
    };

    // Neon says a capture was already started.
    findOrder.mockResolvedValue(order);

    // PayPal does not yet show a completed capture.
    getPayPal.mockResolvedValue({
      status: "APPROVED",
      captureId: null,
      captureStatus: null,
      amountCents: null,
    });

    const response = await capture(post("PAYPALUNCERTAIN"));

    // The endpoint should ask the client to retry later.
    expect(response.status).toBe(409);

    const body = ApiError.parse(await response.json());

    expect(body.error.code).toBe("CHECKOUT_CONFLICT");

    // Verify that PayPal was checked.
    expect(getPayPal).toHaveBeenCalledExactlyOnceWith("PAYPALUNCERTAIN");

    // Most important: no second capture request.
    expect(capturePayPal).not.toHaveBeenCalled();

    // No database finalization or donation ledger entry.
    expect(updateOrder).not.toHaveBeenCalled();
    expect(createLedger).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  test("rejects a captured amount mismatch without creating a ledger entry", async () => {
    const order = {
      id: "order_mismatch",
      userId: "demo-user",
      cartId: "cart_mismatch",
      paypalOrderId: "PAYPALMISMATCH",
      paypalCaptureId: null as string | null,
      status: "CREATED" as string,
      purchaseCents: 5000,
      donationCents: 200,
      causeId: "carbon_removal",
      category: "air_travel",
      userAction: "accepted",
      classificationSource: "llm",
    };

    findOrder.mockImplementation(async () => ({ ...order }));

    // Simulate Neon claiming the order for capture.
    updateOrder.mockImplementation(async ({ data }) => {
      if (data.status) {
        order.status = data.status;
      }

      if ("paypalCaptureId" in data) {
        order.paypalCaptureId = data.paypalCaptureId;
      }

      return { count: 1 };
    });

    // PayPal reports $53.00 instead of the expected $52.00.
    capturePayPal.mockResolvedValue({
      status: "COMPLETED",
      captureId: "CAPTUREMISMATCH",
      amountCents: 5300,
      currencyCode: "USD",
    });

    const response = await capture(post("PAYPALMISMATCH"));

    expect(response.status).toBe(502);

    const body = ApiError.parse(await response.json());

    expect(body.error.code).toBe("PAYPAL_CAPTURE_FAILED");

    // PayPal was contacted once.
    expect(capturePayPal).toHaveBeenCalledExactlyOnceWith("PAYPALMISMATCH");

    // Neon must not mark the order COMPLETED.
    expect(order.status).toBe("CAPTURING");
    expect(order.paypalCaptureId).toBeNull();

    // No donation should be recorded for a mismatched capture.
    expect(createLedger).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();

    // Only the initial CREATED -> CAPTURING claim occurred.
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });

  test("handles PayPal capture failure without creating a ledger entry", async () => {
    const order = {
      id: "order_failure",
      userId: "demo-user",
      cartId: "cart_failure",
      paypalOrderId: "PAYPALFAILURE",
      paypalCaptureId: null as string | null,
      status: "CREATED" as string,
      purchaseCents: 5000,
      donationCents: 200,
      causeId: "carbon_removal",
      category: "air_travel",
      userAction: "accepted",
      classificationSource: "llm",
    };

    findOrder.mockImplementation(async () => ({ ...order }));

    // Simulate Neon claiming the order for capture.
    updateOrder.mockImplementation(async ({ data }) => {
      if (data.status) {
        order.status = data.status;
      }

      return { count: 1 };
    });

    // Simulate a PayPal API failure.
    capturePayPal.mockRejectedValue(new Error("PayPal request timed out"));

    const response = await capture(post("PAYPALFAILURE"));

    expect(response.status).toBe(502);

    const body = ApiError.parse(await response.json());

    expect(body.error.code).toBe("PAYPAL_CAPTURE_FAILED");

    // The capture endpoint was called exactly once.
    expect(capturePayPal).toHaveBeenCalledExactlyOnceWith("PAYPALFAILURE");

    // The order remains in CAPTURING because the outcome is uncertain.
    expect(order.status).toBe("CAPTURING");
    expect(order.paypalCaptureId).toBeNull();

    // No completed payment should be recorded in Neon.
    expect(createLedger).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();

    // Only the initial CREATED -> CAPTURING claim occurred.
    expect(updateOrder).toHaveBeenCalledTimes(1);
  });

  test("completes a purchase without creating a donation ledger entry", async () => {
    const order = {
      id: "order_no_donation",
      userId: "demo-user",
      cartId: "cart_no_donation",
      paypalOrderId: "PAYPALNODONATION",
      paypalCaptureId: null as string | null,
      status: "CREATED" as string,
      purchaseCents: 5000,
      donationCents: 0,
      causeId: null,
      category: null,
      userAction: "removed",
      classificationSource: null,
    };

    findOrder.mockImplementation(async () => ({ ...order }));

    // Simulate the database status transitions.
    updateOrder.mockImplementation(async ({ data }) => {
      if (data.status) {
        order.status = data.status;
      }

      if ("paypalCaptureId" in data) {
        order.paypalCaptureId = data.paypalCaptureId;
      }

      return { count: 1 };
    });

    // PayPal captures only the $50 purchase.
    capturePayPal.mockResolvedValue({
      status: "COMPLETED",
      captureId: "CAPTURENODONATION",
      amountCents: 5000,
      currencyCode: "USD",
    });

    transaction.mockImplementation(async (callback) => {
      return callback({
        order: {
          findUnique: findOrder,
          updateMany: updateOrder,
        },
        ledgerEntry: {
          findUnique: findLedger,
          create: createLedger,
        },
      });
    });

    const response = await capture(post("PAYPALNODONATION"));

    expect(response.status).toBe(200);

    expect(await response.json()).toEqual({
      status: "COMPLETED",
      localOrderId: "order_no_donation",
      ledgerEntryId: null,
    });

    // PayPal captures the payment exactly once.
    expect(capturePayPal).toHaveBeenCalledExactlyOnceWith("PAYPALNODONATION");

    // The order is finalized successfully.
    expect(order.status).toBe("COMPLETED");
    expect(order.paypalCaptureId).toBe("CAPTURENODONATION");

    // No donation means no ledger entry.
    expect(createLedger).not.toHaveBeenCalled();

    // The database transaction still runs.
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
