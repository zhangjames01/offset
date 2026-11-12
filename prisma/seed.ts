import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import catalog from "../mocks/catalog.json";
import causes from "../mocks/causes.json";
import { CatalogResponse, CauseRegistry } from "../contracts";
import { upsertDemoPreferences } from "./demo-user";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // Use existing environment variables if .env.local is absent.
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const products = CatalogResponse.parse(catalog).products;
    const verifiedCauses = CauseRegistry.parse(causes);
    for (const p of products) {
      await prisma.product.upsert({ where: { id: p.id }, create: p, update: p });
    }
    for (const c of verifiedCauses) {
      const receiver = process.env[`CAUSE_RECEIVER_${c.id.toUpperCase()}`] || c.receiver;
      const data = { ...c, receiver };
      await prisma.cause.upsert({ where: { id: c.id }, create: data, update: data });
    }
    await upsertDemoPreferences(prisma);
    console.log(`Seeded ${products.length} products, ${verifiedCauses.length} causes and demo preferences`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
