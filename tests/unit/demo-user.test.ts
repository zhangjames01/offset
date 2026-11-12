// Seeded demo user + demo reset (A7), against a fake Prisma client that records every call.
import { describe, expect, test } from "vitest";
import { countDemoRows, demoPreferences, DEMO_USER_ID, resetDemoUser, upsertDemoPreferences } from "@/prisma/demo-user";
import { price } from "@/lib/classifier/pricing";

type Call = { model: string; op: string; args: unknown };

function fakeDb(opts: { linkedBatchIds?: string[]; demoOnlyBatchIds?: string[] } = {}) {
  const calls: Call[] = [];
  const model = (name: string, results: Record<string, (args: unknown) => unknown> = {}) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => async (args: unknown) => {
          calls.push({ model: name, op, args });
          if (results[op]) return results[op](args);
          if (op === "deleteMany") return { count: 1 };
          if (op === "count") return 2;
          return {};
        },
      },
    );
  const db = {
    user: model("user"),
    preferences: model("preferences"),
    ledgerEntry: model("ledgerEntry", {
      findMany: () => (opts.linkedBatchIds ?? []).map((payoutBatchId) => ({ payoutBatchId })),
    }),
    payoutBatch: model("payoutBatch", { findMany: () => (opts.demoOnlyBatchIds ?? []).map((id) => ({ id })) }),
    payoutBatchItem: model("payoutBatchItem"),
    order: model("order"),
    checkoutAttempt: model("checkoutAttempt"),
    classificationApproval: model("classificationApproval"),
  };
  return { db: db as unknown as Parameters<typeof resetDemoUser>[0], calls };
}

const writes = (calls: Call[]) => calls.filter((c) => !["findMany", "count"].includes(c.op));

describe("seeded demo user (mocks/preferences.json)", () => {
  test("matches the demo script: $100/month, $5/order, climate + fast fashion, skip packaging", () => {
    expect(demoPreferences).toMatchObject({
      userId: "demo-user",
      causes: ["carbon_removal", "textile_recycling"],
      optOutCategories: ["single_use_packaging"],
      monthlyCapCents: 10000,
      perOrderMaxCents: 500,
    });
  });

  test("the scripted orders come out as the script says: flight $5.00 (capped), tee $0.50", () => {
    const at = (category: "air_travel" | "fast_fashion", subtotalCents: number, monthToDateCents: number) =>
      price({ category, confidence: 0.95, subtotalCents, prefs: demoPreferences, monthToDateCents });
    expect(at("air_travel", 24900, 0)).toMatchObject({ donationCents: 500, adjustment: "per_order_max" });
    expect(at("fast_fashion", 2499, 500)).toMatchObject({ donationCents: 50, maxDonationCents: 500 });
  });

  test("upsertDemoPreferences creates the user, then sets its preferences", async () => {
    const { db, calls } = fakeDb();
    await upsertDemoPreferences(db);
    expect(calls.map((c) => `${c.model}.${c.op}`)).toEqual(["user.upsert", "preferences.upsert"]);
    expect(calls[1].args).toMatchObject({ where: { userId: DEMO_USER_ID }, update: { monthlyCapCents: 10000 } });
  });
});

describe("demo reset", () => {
  test("countDemoRows only reads", async () => {
    const { db, calls } = fakeDb({ linkedBatchIds: ["pb_1"], demoOnlyBatchIds: ["pb_1"] });
    const counts = await countDemoRows(db);
    expect(writes(calls)).toEqual([]);
    expect(counts).toMatchObject({ ledgerEntries: 2, payoutBatches: 1, orders: 2 });
  });

  test("deletes only demo-user rows, children before parents, then re-applies the preferences", async () => {
    const { db, calls } = fakeDb({ linkedBatchIds: ["pb_1", "pb_shared"], demoOnlyBatchIds: ["pb_1"] });
    await resetDemoUser(db);
    const w = writes(calls);
    expect(w.map((c) => `${c.model}.${c.op}`)).toEqual([
      "ledgerEntry.deleteMany",
      "payoutBatchItem.deleteMany",
      "payoutBatch.deleteMany",
      "order.deleteMany",
      "checkoutAttempt.deleteMany",
      "classificationApproval.deleteMany",
      "user.upsert",
      "preferences.upsert",
    ]);
    for (const c of w.filter((c) => ["ledgerEntry", "order", "checkoutAttempt", "classificationApproval"].includes(c.model))) {
      expect(c.args).toEqual({ where: { userId: DEMO_USER_ID } });
    }
    // A batch that also holds another user's entries is kept.
    expect(w[1].args).toEqual({ where: { payoutBatchId: { in: ["pb_1"] } } });
    expect(w[2].args).toEqual({ where: { id: { in: ["pb_1"] } } });
  });

  test("with no payout batches, the batch deletes match nothing", async () => {
    const { db, calls } = fakeDb();
    await resetDemoUser(db);
    expect(calls.find((c) => c.model === "payoutBatch" && c.op === "findMany")).toBeUndefined();
    expect(writes(calls).find((c) => c.model === "payoutBatch")?.args).toEqual({ where: { id: { in: [] } } });
  });
});
