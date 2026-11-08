import { describe, expect, it } from "vitest";
import type { PayoutBatch } from "@/contracts";
import { batchTotalCents, canRefresh, newestFirst, shortName, thresholdProgress, totalCents } from "@/lib/impact";
import { mockLedger } from "@/lib/mocks";

const bal = (pendingCents: number, thresholdCents = 500) => ({ causeId: "food_bank" as const, pendingCents, paidOutCents: 0, thresholdCents });

describe("impact page logic", () => {
  it("measures progress toward the payout threshold", () => {
    expect(thresholdProgress(bal(100))).toEqual({ pct: 20, ready: false, toGoCents: 400 });
    expect(thresholdProgress(bal(500))).toEqual({ pct: 100, ready: true, toGoCents: 0 });
    expect(thresholdProgress(bal(900))).toEqual({ pct: 100, ready: true, toGoCents: 0 });
    expect(thresholdProgress(bal(0, 0))).toEqual({ pct: 0, ready: false, toGoCents: 0 });
  });

  it("sorts newest first and totals the ledger", () => {
    const sorted = newestFirst([...mockLedger.entries].reverse());
    expect(sorted.map((e) => e.id)).toEqual(["led_03", "led_02", "led_01"]);
    expect(totalCents(mockLedger.entries)).toBe(650);
  });

  it("only refreshes unsettled sandbox batches", () => {
    const b = (mode: PayoutBatch["mode"], status: PayoutBatch["status"]) =>
      ({ mode, status, items: [{ amountCents: 300 }, { amountCents: 200 }] }) as PayoutBatch;
    expect(canRefresh(b("sandbox", "PENDING"))).toBe(true);
    expect(canRefresh(b("sandbox", "SUCCESS"))).toBe(false);
    expect(canRefresh(b("simulated", "SIMULATED"))).toBe(false);
    expect(batchTotalCents(b("simulated", "SIMULATED"))).toBe(500);
  });

  it("drops the placeholder suffix from cause names", () => {
    expect(shortName("Food bank (placeholder partner)")).toBe("Food bank");
  });
});
