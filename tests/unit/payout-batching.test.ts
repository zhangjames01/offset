import { beforeEach, describe, expect, test, vi } from "vitest";

const { findLedger, findCauses, createBatch, updateLedger, transaction } =
  vi.hoisted(() => ({
    findLedger: vi.fn(),
    findCauses: vi.fn(),
    createBatch: vi.fn(),
    updateLedger: vi.fn(),
    transaction: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  getPrisma: () => ({ $transaction: transaction }),
}));

import { claimPayoutBatch } from "@/lib/payouts/batching";

type Entry = {
  id: string;
  causeId: string;
  amountCents: number;
  status: string;
  payoutBatchId: string | null;
  createdAt: Date;
};

const entries: Entry[] = [];
let nextBatch = 1;

beforeEach(() => {
  vi.clearAllMocks();
  nextBatch = 1;
  entries.splice(0, entries.length,
    {
      id: "led_1", causeId: "food_bank", amountCents: 60,
      status: "pending_payout", payoutBatchId: null,
      createdAt: new Date("2026-11-01T00:00:00Z"),
    },
    {
      id: "led_2", causeId: "food_bank", amountCents: 40,
      status: "pending_payout", payoutBatchId: null,
      createdAt: new Date("2026-11-02T00:00:00Z"),
    },
  );

  findLedger.mockImplementation(async () =>
    entries.filter((e) => e.status === "pending_payout" && e.payoutBatchId === null)
      .map((e) => ({ ...e })),
  );
  findCauses.mockResolvedValue([
    { id: "food_bank", receiver: "food-bank@example.com" },
  ]);
  createBatch.mockImplementation(async () => ({ id: `batch_${nextBatch++}` }));
  updateLedger.mockImplementation(async ({ where, data }) => {
    let count = 0;
    for (const entry of entries) {
      if (
        where.id.in.includes(entry.id) &&
        entry.status === where.status &&
        entry.payoutBatchId === where.payoutBatchId
      ) {
        Object.assign(entry, data);
        count++;
      }
    }
    return { count };
  });
  transaction.mockImplementation(async (callback) =>
    callback({
      ledgerEntry: { findMany: findLedger, updateMany: updateLedger },
      cause: { findMany: findCauses },
      payoutBatch: { create: createBatch },
    }),
  );
});

describe("claimPayoutBatch()", () => {
  test("claims eligible donations once, then finds nothing to claim again", async () => {
    const first = await claimPayoutBatch(100, "sandbox");
    expect(first).toMatchObject({
      id: "batch_1",
      thresholdCents: 100,
      items: [{
        causeId: "food_bank",
        receiver: "food-bank@example.com",
        amountCents: 100,
        ledgerEntryIds: ["led_1", "led_2"],
      }],
    });
    expect(first?.senderBatchId).toMatch(/^offset-/);
    expect(entries.every((e) => e.payoutBatchId === "batch_1")).toBe(true);
    expect(entries.every((e) => e.status === "pending_payout")).toBe(true);

    const second = await claimPayoutBatch(100, "sandbox");
    expect(second).toBeNull();
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });

  test("does not create a batch below the threshold", async () => {
    expect(await claimPayoutBatch(101, "sandbox")).toBeNull();
    expect(createBatch).not.toHaveBeenCalled();
    expect(updateLedger).not.toHaveBeenCalled();
  });

  test("rejects a claim when an entry was already taken", async () => {
    updateLedger.mockResolvedValueOnce({ count: 1 });
    await expect(claimPayoutBatch(100, "sandbox"))
      .rejects.toThrow("Concurrent payout claim detected for food_bank");
    expect(updateLedger).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "pending_payout",
        payoutBatchId: null,
      }),
    }));
  });

  test("simulated mode marks claimed entries as simulated_paid_out", async () => {
    await claimPayoutBatch(100, "simulated");
    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "simulated", status: "SIMULATED" }),
    }));
    expect(entries.every((e) => e.status === "simulated_paid_out")).toBe(true);
  });

  test("sandbox mode requires a nonempty receiver", async () => {
    findCauses.mockResolvedValueOnce([{ id: "food_bank", receiver: "  " }]);
    await expect(claimPayoutBatch(100, "sandbox"))
      .rejects.toThrow("Missing payout receiver for cause food_bank");
    expect(createBatch).not.toHaveBeenCalled();
  });

  test.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid threshold %s", async (threshold) => {
      await expect(claimPayoutBatch(threshold, "sandbox"))
        .rejects.toThrow("Invalid payout threshold");
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
