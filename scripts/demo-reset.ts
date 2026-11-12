import { Prisma, PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvFile } from "node:process";

const execute = process.argv.includes("--execute");
const verifyTestDb = process.argv.includes("--verify-test-db");
const testMode = execute || verifyTestDb;
const envFile = testMode ? ".env.j8-test" : ".env.local";
const DEMO_USER_ID = "demo-user";

if (execute && !process.argv.includes("--confirm-demo-reset")) {
  throw new Error("Reset blocked: --execute requires --confirm-demo-reset");
}

// Never let shell variables silently override the isolated test configuration.
if (testMode) {
  for (const key of [
    "DATABASE_URL",
    "PAYPAL_ENV",
    "PAYOUT_MODE",
    "DEMO_RESET_ALLOWED",
    "J8_TEST_DB_HOST",
  ]) {
    if (process.env[key] !== undefined) {
      throw new Error(`Remove ${key} from the shell before test mode.`);
    }
  }
}

loadEnvFile(envFile);

if (execute && process.env.DEMO_RESET_ALLOWED !== "true") {
  throw new Error("Reset blocked: DEMO_RESET_ALLOWED=true is required");
}

// J8_TEST_DB_HOST must be copied from the j8-reset-test connection details
// in Neon Console, not inferred from the DATABASE_URL in this file.
if (testMode) {
  if (!process.env.DATABASE_URL || !process.env.J8_TEST_DB_HOST) {
    throw new Error("Test mode requires DATABASE_URL and J8_TEST_DB_HOST");
  }

  const actualHost = new URL(process.env.DATABASE_URL).hostname.toLowerCase();
  const expectedHost = process.env.J8_TEST_DB_HOST.trim().toLowerCase();
  if (!expectedHost || actualHost !== expectedHost) {
    throw new Error("Reset blocked: Neon test connection hostname mismatch");
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  if (
    process.env.PAYPAL_ENV !== "sandbox" ||
    process.env.PAYOUT_MODE !== "sandbox"
  ) {
    throw new Error("Demo reset requires sandbox PayPal and payouts");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    }),
  });

  try {
    if (testMode) {
      const result = await prisma.$queryRaw<{ marker: string }[]>`
        SELECT marker
        FROM j8_reset_guard
        WHERE marker = 'j8-reset-test'
      `;

      if (result.length !== 1) {
        throw new Error("J8 test database guard marker not found");
      }
      console.log("J8 test database guard verified.");
    }

    if (verifyTestDb) {
      console.log("J8 test database verified successfully.");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: DEMO_USER_ID },
    });

    if (!user) {
      throw new Error("Demo user not found");
    }

    // Find all donations belonging to the demo user.
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { userId: DEMO_USER_ID },
      select: {
        id: true,
        payoutBatchId: true,
        status: true,
      },
    });

    const attachedEntries = ledgerEntries.filter(
      (entry) => entry.payoutBatchId !== null,
    );

    console.log(`Found ${ledgerEntries.length} demo donations.`);

    // Find payout batches associated with demo donations.
    const batchIds = [
      ...new Set(
        attachedEntries
          .map((entry) => entry.payoutBatchId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const batches = await prisma.payoutBatch.findMany({
      where: {
        id: { in: batchIds },
      },
      include: {
        items: true,
        ledgerEntries: {
          select: {
            id: true,
            userId: true,
            status: true,
          },
        },
      },
    });

    // Validate payout batches before resetting anything.
    if (attachedEntries.length > 0) {
      console.log(
        `${attachedEntries.length} donations are attached to payout batches.`,
      );

      const safeStatuses = ["SIMULATED", "SUCCESS"];

      if (batches.length !== batchIds.length) {
        throw new Error(
          "Reset blocked: one or more payout batches were not found.",
        );
      }

      for (const batch of batches) {
        const allDemoEntries = batch.ledgerEntries.every(
          (entry) => entry.userId === DEMO_USER_ID,
        );

        const hasEntries = batch.ledgerEntries.length > 0;

        if (
          !hasEntries ||
          !allDemoEntries ||
          !safeStatuses.includes(batch.status) ||
          !["simulated", "sandbox"].includes(batch.mode)
        ) {
          throw new Error(`Unsafe payout batch ${batch.id}: reset blocked`);
        }

        if (
          batch.mode === "sandbox" &&
          (!batch.paypalPayoutBatchId || batch.status !== "SUCCESS")
        ) {
          throw new Error(
            `Sandbox payout batch ${batch.id} is not confirmed complete`,
          );
        }
      }

      console.log("All attached payout batches passed safety checks.");
    }

    // Dry-run mode is enabled by default.
    const dryRun = !execute;

    if (dryRun) {
      const [orders, checkoutAttempts, approvals] = await Promise.all([
        prisma.order.count({
          where: { userId: DEMO_USER_ID },
        }),
        prisma.checkoutAttempt.count({
          where: { userId: DEMO_USER_ID },
        }),
        prisma.classificationApproval.count({
          where: { userId: DEMO_USER_ID },
        }),
      ]);

      console.log("DRY RUN — no records will be deleted.");
      console.log({
        orders,
        checkoutAttempts,
        approvals,
        ledgerEntries: ledgerEntries.length,
        payoutBatches: batches.length,
      });

      return;
    }

    // Load demo preferences from the mock file.
    const { default: preferencesJson } =
      await import("../mocks/preferences.json");

    if (preferencesJson.userId !== DEMO_USER_ID) {
      throw new Error("Demo preferences user ID does not match");
    }

    // Reset demo records in a single transaction.
    await prisma.$transaction(
      async (tx) => {
        // Re-read demo donations inside the transaction.
        const currentEntries = await tx.ledgerEntry.findMany({
          where: { userId: DEMO_USER_ID },
          select: {
            id: true,
            payoutBatchId: true,
            status: true,
          },
        });

        const currentBatchIds = [
          ...new Set(
            currentEntries
              .map((entry) => entry.payoutBatchId)
              .filter((id): id is string => id !== null),
          ),
        ];

        const originalEntries = new Map(
          ledgerEntries.map((entry) => [entry.id, entry]),
        );

        // Block execution if the payout batch selection has changed.
        if (
          currentEntries.length !== ledgerEntries.length ||
          currentEntries.some((entry) => {
            const original = originalEntries.get(entry.id);

            return (
              !original ||
              entry.payoutBatchId !== original.payoutBatchId ||
              entry.status !== original.status
            );
          }) ||
          currentBatchIds.length !== batchIds.length ||
          currentBatchIds.some((id) => !batchIds.includes(id))
        ) {
          throw new Error(
            "Reset blocked: demo donations or payout batches changed.",
          );
        }

        // Revalidate every attached payout batch.
        const currentBatches = await tx.payoutBatch.findMany({
          where: { id: { in: currentBatchIds } },
          include: {
            ledgerEntries: {
              select: { userId: true },
            },
          },
        });

        if (currentBatches.length !== currentBatchIds.length) {
          throw new Error("Reset blocked: payout batch missing.");
        }

        for (const batch of currentBatches) {
          if (
            batch.ledgerEntries.length === 0 ||
            batch.ledgerEntries.some(
              (entry) => entry.userId !== DEMO_USER_ID,
            ) ||
            !["SIMULATED", "SUCCESS"].includes(batch.status) ||
            !["simulated", "sandbox"].includes(batch.mode) ||
            (batch.mode === "sandbox" &&
              (batch.status !== "SUCCESS" || !batch.paypalPayoutBatchId))
          ) {
            throw new Error(`Reset blocked: unsafe payout batch ${batch.id}`);
          }
        }

        // Block resets while checkout operations are active.
        const activeAttempts = await tx.checkoutAttempt.count({
          where: {
            userId: DEMO_USER_ID,
            status: {
              in: ["PENDING", "PROCESSING"],
            },
          },
        });

        if (activeAttempts > 0) {
          throw new Error(
            `Reset blocked: ${activeAttempts} checkout attempts are still active.`,
          );
        }
        // Remove checkout attempts.
        await tx.checkoutAttempt.deleteMany({
          where: { userId: DEMO_USER_ID },
        });

        // Block reset if any demo order is not finalized.
        const unfinishedOrders = await tx.order.count({
          where: {
            userId: DEMO_USER_ID,
            status: {
              not: "COMPLETED",
            },
          },
        });

        if (unfinishedOrders > 0) {
          throw new Error(
            `Reset blocked: ${unfinishedOrders} demo orders are not completed.`,
          );
        }

        // Remove classification approvals.
        await tx.classificationApproval.deleteMany({
          where: { userId: DEMO_USER_ID },
        });

        // Remove donations.
        await tx.ledgerEntry.deleteMany({
          where: { userId: DEMO_USER_ID },
        });

        // Remove payout items from validated demo-only batches.
        await tx.payoutBatchItem.deleteMany({
          where: {
            payoutBatchId: { in: batchIds },
          },
        });

        // Remove the now-empty payout batches.
        await tx.payoutBatch.deleteMany({
          where: {
            id: { in: batchIds },
          },
        });

        // Remove demo orders.
        await tx.order.deleteMany({
          where: { userId: DEMO_USER_ID },
        });

        // Restore demo preferences.
        const { userId, updatedAt, ...settings } = preferencesJson;

        await tx.preferences.upsert({
          where: { userId: DEMO_USER_ID },
          create: {
            userId: DEMO_USER_ID,
            ...settings,
            updatedAt: new Date(updatedAt),
          },
          update: {
            ...settings,
            updatedAt: new Date(updatedAt),
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );

    console.log("Demo user reset completed successfully.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
