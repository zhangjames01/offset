
import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  findBatch,
  claimBatch,
  updateBatch,
  updateLedger,
  transaction,
  getAccessToken,
  createPayout,
} = vi.hoisted(() => ({
  findBatch: vi.fn(),
  claimBatch: vi.fn(),
  updateBatch: vi.fn(),
  updateLedger: vi.fn(),
  transaction: vi.fn(),
  getAccessToken: vi.fn(),
  createPayout: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrisma: () => ({
    payoutBatch: {
      findUnique: findBatch,
      updateMany: claimBatch,
      update: updateBatch,
    },
    $transaction: transaction,
  }),
}));

vi.mock("@/lib/paypal/client", () => ({
  getAccessToken,
}));

vi.mock("@/lib/paypal/payouts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/paypal/payouts")>();

  return {
    ...original,
    createSandboxPayout: createPayout,
  };
});

import { executeSandboxPayout } from "@/lib/payouts/execution";
import { DefinitivePayoutRejection } from "@/lib/paypal/payouts";

const batch = {
  id: "batch_1",
  mode: "sandbox",
  status: "PENDING",
  paypalPayoutBatchId: null,
  senderBatchId: "offset-batch-1",
  items: [
    {
      causeId: "food_bank",
      receiver: "food@sandbox.example",
      amountCents: 100,
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();

  findBatch.mockResolvedValue(batch);
  getAccessToken.mockResolvedValue("sandbox-token");
  claimBatch.mockResolvedValue({ count: 1 });
  updateBatch.mockResolvedValue({ ...batch, status: "PROCESSING" });
  updateLedger.mockResolvedValue({ count: 1 });

  transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        payoutBatch: { updateMany: claimBatch },
        ledgerEntry: { updateMany: updateLedger },
      }),
  );
});

describe("Sandbox payout execution recovery", () => {
  test("token failure leaves batch PENDING", async () => {
    getAccessToken.mockRejectedValue(
      new Error("PayPal authentication failed"),
    );

    await expect(executeSandboxPayout("batch_1")).rejects.toThrow(
      "PayPal authentication failed",
    );

    expect(claimBatch).not.toHaveBeenCalled();
    expect(createPayout).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  test("definite rejection releases claimed donations", async () => {
    createPayout.mockRejectedValue(
      new DefinitivePayoutRejection("Invalid payout request"),
    );

    await expect(executeSandboxPayout("batch_1")).rejects.toThrow(
      "Invalid payout request",
    );

    expect(claimBatch).toHaveBeenCalledWith({
      where: {
        id: "batch_1",
        status: "PENDING",
        paypalPayoutBatchId: null,
      },
      data: { status: "PROCESSING" },
    });

    expect(transaction).toHaveBeenCalledOnce();

    expect(claimBatch).toHaveBeenCalledWith({
      where: {
        id: "batch_1",
        status: "PROCESSING",
        paypalPayoutBatchId: null,
      },
      data: { status: "DENIED" },
    });

    expect(updateLedger).toHaveBeenCalledWith({
      where: {
        payoutBatchId: "batch_1",
        status: "pending_payout",
      },
      data: { payoutBatchId: null },
    });
  });

  test("network timeout keeps batch PROCESSING", async () => {
    createPayout.mockRejectedValue(
      new Error("Network timeout"),
    );

    await expect(executeSandboxPayout("batch_1")).rejects.toThrow(
      "Network timeout",
    );

    expect(claimBatch).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
    expect(updateLedger).not.toHaveBeenCalled();
    expect(updateBatch).not.toHaveBeenCalled();
  });
});
