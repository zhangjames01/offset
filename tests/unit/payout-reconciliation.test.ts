import { beforeEach, describe, expect, test, vi } from "vitest";

const { findBatch, updateBatch, updateLedger, getPayout, transaction } = vi.hoisted(() => ({
  findBatch: vi.fn(),
  updateBatch: vi.fn(),
  updateLedger: vi.fn(),
  getPayout: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrisma: () => ({
    payoutBatch: { findUnique: findBatch },
    $transaction: transaction,
  }),
}));

vi.mock("@/lib/paypal/payouts", () => ({
  getSandboxPayout: getPayout,
}));

import { reconcileSandboxPayout } from "@/lib/payouts/reconciliation";

const batch = {
  id: "batch_1",
  mode: "sandbox",
  paypalPayoutBatchId: "PAYPAL_BATCH_1",
  senderBatchId: "offset-batch-1",
  items: [
    { causeId: "food_bank", receiver: "food@sandbox.example" },
  ],
};

const paypalItem = (status: string) => ({
  senderItemId: "offset-batch-1-0",
  payoutItemId: "PAYOUT_ITEM_1",
  status,
  receiver: "food@sandbox.example",
});

beforeEach(() => {
  vi.resetAllMocks();
  findBatch.mockResolvedValue(batch);
  updateBatch.mockResolvedValue({});
  updateLedger.mockResolvedValue({ count: 1 });
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      payoutBatch: { update: updateBatch },
      ledgerEntry: { updateMany: updateLedger },
    }),
  );
});

describe("Sandbox payout reconciliation (J7)", () => {
  test("marks only confirmed successful payout items as paid_out", async () => {
    getPayout.mockResolvedValue({
      paypalPayoutBatchId: "PAYPAL_BATCH_1",
      status: "SUCCESS",
      items: [paypalItem("SUCCESS")],
    });

    const result = await reconcileSandboxPayout("batch_1");

    expect(result.status).toBe("SUCCESS");
    expect(getPayout).toHaveBeenCalledWith("PAYPAL_BATCH_1");
    expect(updateBatch).toHaveBeenCalledWith({
      where: { id: "batch_1" },
      data: { status: "SUCCESS" },
    });
    expect(updateLedger).toHaveBeenCalledWith({
      where: {
        payoutBatchId: "batch_1",
        causeId: "food_bank",
        status: "pending_payout",
      },
      data: { status: "paid_out" },
    });
  });

  test("does not mark an unsuccessful payout item as paid_out", async () => {
    getPayout.mockResolvedValue({
      paypalPayoutBatchId: "PAYPAL_BATCH_1",
      status: "DENIED",
      items: [paypalItem("FAILED")],
    });

    await reconcileSandboxPayout("batch_1");

    expect(updateBatch).toHaveBeenCalledWith({
      where: { id: "batch_1" },
      data: { status: "DENIED" },
    });
    expect(updateLedger).not.toHaveBeenCalled();
  });

  test("rejects an incomplete item list before writing to the database", async () => {
    getPayout.mockResolvedValue({
      paypalPayoutBatchId: "PAYPAL_BATCH_1",
      status: "SUCCESS",
      items: [],
    });

    await expect(reconcileSandboxPayout("batch_1")).rejects.toThrow(
      "Incomplete PayPal payout items",
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(updateBatch).not.toHaveBeenCalled();
    expect(updateLedger).not.toHaveBeenCalled();
  });

  test("rejects a sender item ID belonging to another batch", async () => {
    getPayout.mockResolvedValue({
      paypalPayoutBatchId: "PAYPAL_BATCH_1",
      status: "SUCCESS",
      items: [{ ...paypalItem("SUCCESS"), senderItemId: "offset-other-0" }],
    });

    await expect(reconcileSandboxPayout("batch_1")).rejects.toThrow(
      "Unexpected PayPal sender item ID",
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(updateLedger).not.toHaveBeenCalled();
  });
});
