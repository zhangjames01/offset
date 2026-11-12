import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createSandboxPayout,
  DefinitivePayoutRejection,
} from "@/lib/paypal/payouts";

describe("PayPal Sandbox payout HTTP errors", () => {
  const fetchMock = vi.fn();

  const payoutItems = [
    {
      causeId: "food_bank",
      receiver: "food@sandbox.example",
      amountCents: 100,
    },
  ];

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function submitPayout() {
    return createSandboxPayout(
      "offset-test-batch",
      payoutItems,
      "test-access-token",
    );
  }

  test.each([401, 403])(
    "treats HTTP %i as a definitive rejection",
    async (status) => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () =>
          JSON.stringify({
            name: "NOT_AUTHORIZED",
            message: "Payout permission denied",
          }),
      });

      await expect(submitPayout()).rejects.toBeInstanceOf(
        DefinitivePayoutRejection,
      );

      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  test.each([400, 422])(
    "treats recognized HTTP %i validation errors as definitive",
    async (status) => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () =>
          JSON.stringify({
            name: "INVALID_REQUEST",
            message: "Invalid payout",
          }),
      });

      await expect(submitPayout()).rejects.toBeInstanceOf(
        DefinitivePayoutRejection,
      );
    },
  );

  test.each([429, 500, 503])(
    "keeps HTTP %i errors ambiguous",
    async (status) => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () =>
          JSON.stringify({
            name: "INTERNAL_SERVER_ERROR",
          }),
      });

      await expect(submitPayout()).rejects.toThrow(
        `PayPal payout failed: ${status}`,
      );
    },
  );

  test.each([429, 500, 503])(
    "keeps HTTP %i errors ambiguous",
    async (status) => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => JSON.stringify({ name: "INTERNAL_SERVER_ERROR" }),
      });

      await expect(submitPayout()).rejects.not.toBeInstanceOf(
        DefinitivePayoutRejection,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  test("keeps unrecognized HTTP 422 errors ambiguous", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ name: "UNKNOWN_PAYPAL_ERROR" }),
    });

    await expect(submitPayout()).rejects.toThrow("PayPal payout failed: 422");
  });

  test("keeps network timeouts ambiguous", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network timeout"));

    await expect(submitPayout()).rejects.toThrow("Network timeout");
  });

  test("accepts a successful payout submission", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        batch_header: {
          payout_batch_id: "PAYPAL_BATCH_123",
          batch_status: "PENDING",
        },
      }),
    });

    await expect(submitPayout()).resolves.toMatchObject({
      paypalPayoutBatchId: "PAYPAL_BATCH_123",
      status: "PENDING",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    const body = JSON.parse(options.body as string);

    expect(body.items[0].sender_item_id).toBe("offset-test-batch-food_bank");
  });
});
