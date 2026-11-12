import { defineConfig, devices } from "@playwright/test";

// A6: end-to-end demo test. Runs against a deployed app (the Render URL) in PayPal sandbox,
// never in CI: it needs sandbox buyer credentials and the admin token. See tests/e2e/README.md.
try {
  process.loadEnvFile(".env.e2e");
} catch {
  // No .env.e2e: rely on real environment variables.
}

export default defineConfig({
  testDir: "tests/e2e",
  // Two PayPal popups, a payout and a possible Render cold start (~1 min on the free plan).
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://offset-udcc.onrender.com",
    ...devices["Desktop Chrome"],
    trace: "on",
    video: "on",
    screenshot: "on",
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    // Playwright's API requests ignore HTTPS_PROXY on their own; pass it through when one is set.
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
  },
});
