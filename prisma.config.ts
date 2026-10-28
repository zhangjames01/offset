import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files on its own. Load .env.local if it exists.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local (CI, Render) — rely on real environment variables.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
