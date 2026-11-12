// npm run demo:reset            → shows what would be deleted for demo-user (changes nothing)
// npm run demo:reset -- --yes   → deletes it in one transaction and re-applies the demo preferences
//
// Clears demo-user's orders, ledger entries, payout batches (only those holding just its
// entries), checkout attempts and classifications, so the monthly cap starts at $0.
// Uses DATABASE_URL (from .env.local or the environment). Run before a demo or judging.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { countDemoRows, demoOrdersByStatus, DEMO_USER_ID, resetDemoUser, type DemoRowCounts } from "../prisma/demo-user";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — use the environment.
}

const show = (c: DemoRowCounts) =>
  Object.entries(c)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (set it in .env.local or the environment)");
  const yes = process.argv.includes("--yes");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    console.log(`Database: ${new URL(url).host}\nUser: ${DEMO_USER_ID}`);
    const byStatus = Object.entries(await demoOrdersByStatus(prisma));
    console.log(`Orders by status: ${byStatus.length ? byStatus.map(([s, n]) => `${s} ${n}`).join(" · ") : "none"}`);
    const capturing = Object.fromEntries(byStatus).CAPTURING ?? 0;
    if (capturing > 0) console.log(`Warning: ${capturing} order(s) are CAPTURING (checkout in progress); --yes will refuse until they finish.`);
    if (!yes) {
      console.log(`Would delete:\n${show(await countDemoRows(prisma))}\nNothing changed. Re-run with -- --yes to reset.`);
      return;
    }
    const deleted = await prisma.$transaction((tx) => resetDemoUser(tx), { timeout: 30_000 });
    console.log(`Deleted:\n${show(deleted)}\nDemo preferences re-applied. Month-to-date is now $0.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
