// The seeded demo user (A7): one place for the demo preferences and the demo reset.
// prisma/seed.ts upserts the preferences on every deploy; scripts/demo-reset.ts clears
// the demo user's history so the month-to-date cap starts at $0 before a demo or judging.
import type { PrismaClient } from "../lib/generated/prisma/client";
import preferences from "../mocks/preferences.json";
import { Preferences } from "../contracts";

export const demoPreferences = Preferences.parse(preferences);
export const DEMO_USER_ID = demoPreferences.userId;

export type DemoRowCounts = {
  ledgerEntries: number;
  payoutBatches: number;
  payoutBatchItems: number;
  orders: number;
  checkoutAttempts: number;
  classificationApprovals: number;
};

type Db = Pick<
  PrismaClient,
  "user" | "preferences" | "ledgerEntry" | "payoutBatch" | "payoutBatchItem" | "order" | "checkoutAttempt" | "classificationApproval"
>;

/** Creates the demo user if needed and sets its preferences to mocks/preferences.json. */
export async function upsertDemoPreferences(db: Db) {
  await db.user.upsert({ where: { id: DEMO_USER_ID }, create: { id: DEMO_USER_ID }, update: {} });
  const { updatedAt, ...data } = demoPreferences;
  const row = { ...data, updatedAt: new Date(updatedAt) };
  await db.preferences.upsert({ where: { userId: DEMO_USER_ID }, create: row, update: row });
}

/** Payout batches that hold demo-user entries and nobody else's (safe to delete with them). */
async function demoOnlyBatchIds(db: Db): Promise<string[]> {
  const linked = await db.ledgerEntry.findMany({
    where: { userId: DEMO_USER_ID, payoutBatchId: { not: null } },
    select: { payoutBatchId: true },
    distinct: ["payoutBatchId"],
  });
  const ids = linked.map((e) => e.payoutBatchId).filter((id): id is string => id !== null);
  if (ids.length === 0) return [];
  const own = await db.payoutBatch.findMany({
    where: { id: { in: ids }, ledgerEntries: { none: { userId: { not: DEMO_USER_ID } } } },
    select: { id: true },
  });
  return own.map((b) => b.id);
}

/** What resetDemoUser() would delete. Read-only. */
export async function countDemoRows(db: Db): Promise<DemoRowCounts> {
  const batchIds = await demoOnlyBatchIds(db);
  const user = { userId: DEMO_USER_ID };
  const [ledgerEntries, payoutBatchItems, orders, checkoutAttempts, classificationApprovals] = await Promise.all([
    db.ledgerEntry.count({ where: user }),
    db.payoutBatchItem.count({ where: { payoutBatchId: { in: batchIds } } }),
    db.order.count({ where: user }),
    db.checkoutAttempt.count({ where: user }),
    db.classificationApproval.count({ where: user }),
  ]);
  return { ledgerEntries, payoutBatches: batchIds.length, payoutBatchItems, orders, checkoutAttempts, classificationApprovals };
}

/**
 * Deletes the demo user's orders, ledger entries, checkout attempts, classifications and the
 * payout batches that only held its entries, then re-applies the demo preferences.
 * Run inside one transaction (scripts/demo-reset.ts does).
 */
export async function resetDemoUser(db: Db): Promise<DemoRowCounts> {
  const batchIds = await demoOnlyBatchIds(db);
  const user = { userId: DEMO_USER_ID };
  // Foreign keys: ledger entries point at orders and batches; batch items point at batches.
  const ledgerEntries = (await db.ledgerEntry.deleteMany({ where: user })).count;
  const payoutBatchItems = (await db.payoutBatchItem.deleteMany({ where: { payoutBatchId: { in: batchIds } } })).count;
  const payoutBatches = (await db.payoutBatch.deleteMany({ where: { id: { in: batchIds } } })).count;
  const orders = (await db.order.deleteMany({ where: user })).count;
  const checkoutAttempts = (await db.checkoutAttempt.deleteMany({ where: user })).count;
  const classificationApprovals = (await db.classificationApproval.deleteMany({ where: user })).count;
  await upsertDemoPreferences(db);
  return { ledgerEntries, payoutBatches, payoutBatchItems, orders, checkoutAttempts, classificationApprovals };
}
