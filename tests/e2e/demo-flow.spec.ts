/**
 * A6: the full 90-second demo flow against a deployed app in PayPal sandbox.
 *
 *   preferences → flight purchase with donation → fast-fashion purchase with an edited
 *   (overridden) donation → impact page → admin payout
 *
 * Writes real rows (orders, ledger entries, a payout batch) to the deployed database.
 * Env (or .env.e2e): PAYPAL_SANDBOX_BUYER_EMAIL, PAYPAL_SANDBOX_BUYER_PASSWORD, E2E_ADMIN_TOKEN,
 * optional E2E_BASE_URL and E2E_EXPECT_LLM=1 (assert the card came from the model, not rules).
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const env = (k: string) => process.env[k]?.trim() ?? "";
const BUYER_EMAIL = env("PAYPAL_SANDBOX_BUYER_EMAIL");
const BUYER_PASSWORD = env("PAYPAL_SANDBOX_BUYER_PASSWORD");
const ADMIN_TOKEN = env("E2E_ADMIN_TOKEN");
const EXPECT_LLM = env("E2E_EXPECT_LLM") === "1";

// $100/month is the parser's ceiling: enough room for many runs this month (each gives $6).
const PREFS_TEXT = "I care about climate and fashion waste. Up to $100 a month, $5 per order. Skip packaging.";

type Capture = { status: string; localOrderId: string; ledgerEntryId: string | null };
type LedgerEntry = {
  id: string;
  causeId: string;
  category: string;
  amountCents: number;
  userAction: string;
  classificationSource: string;
  status: string;
  payoutBatchId: string | null;
};
type Batch = {
  id: string;
  mode: "sandbox" | "simulated";
  status: string;
  paypalPayoutBatchId: string | null;
  items: { causeId: string; amountCents: number; ledgerEntryIds: string[] }[];
};

test.skip(
  !BUYER_EMAIL || !BUYER_PASSWORD || !ADMIN_TOKEN,
  "Set PAYPAL_SANDBOX_BUYER_EMAIL, PAYPAL_SANDBOX_BUYER_PASSWORD and E2E_ADMIN_TOKEN (see tests/e2e/README.md)",
);

test("demo flow: preferences → flight → tee with override → impact → payout", async ({ page, request }) => {
  const started = Date.now();
  const timings: string[] = [];
  const lap = (label: string) => timings.push(`${label}: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  await test.step("wake the server", async () => {
    // Free Render instances sleep after 15 idle minutes and take about a minute to wake.
    const res = await request.get("/api/catalog", { timeout: 120_000 });
    expect(res.ok()).toBeTruthy();
    lap("server awake");
  });

  await test.step("preferences: parse text, check chips, save", async () => {
    await page.goto("/preferences");
    const text = page.getByLabel("In your own words");
    await expect(text).toBeEnabled();
    await text.fill(PREFS_TEXT);
    await page.getByRole("button", { name: "Update from text" }).click();
    await expect(page.getByRole("status")).toContainText(/Review the choices below|Text changed/);

    if (EXPECT_LLM) {
      // Live parser: the text alone should produce these.
      const causes = page.getByRole("group", { name: "Causes I support" });
      await expect(causes.getByRole("button", { name: /Carbon removal/ })).toHaveAttribute("aria-pressed", "true");
      await expect(causes.getByRole("button", { name: /Textile recycling/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Monthly cap")).toHaveValue(/^100(\.00)?$/);
      await expect(page.getByLabel("Max per order")).toHaveValue(/^5(\.00)?$/);
    } else {
      // Mock/rules parse returns other text; keep the parsed text so Save is allowed.
      const undo = page.getByRole("button", { name: "undo the text change" });
      if (await undo.isVisible()) await undo.click();
    }

    // Make the demo state explicit whatever the parser returned.
    await setChip(page, "Causes I support", /Carbon removal/, true);
    await setChip(page, "Causes I support", /Textile recycling/, true);
    await setChip(page, "Don't suggest donations for", /Air travel/, false);
    await setChip(page, "Don't suggest donations for", /Fast fashion/, false);
    await page.getByLabel("Monthly cap").fill("100");
    await page.getByLabel("Max per order").fill("5");

    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByRole("status")).toContainText("✓ Saved");
    lap("preferences saved");
  });

  const flight = await test.step("flight: donation card capped at $5, pay in sandbox", async () => {
    await addToCartAndCheckout(page, "JFK → LAX economy");
    const card = page.getByRole("region", { name: "Suggested donation" });
    await expect(card).toContainText("Air travel", { timeout: 30_000 });
    await expect(card).toContainText("Carbon removal");
    await expect(card).toContainText("$5.00"); // 3% of $249 = $7.47, capped at the $5 per-order max
    if (EXPECT_LLM) await expect(card).not.toContainText("rule-based fallback");
    await expect(card).toContainText("✓ Included");

    const capture = await payWithPayPal(page);
    await expect(page.getByRole("heading", { name: "Payment complete" })).toBeVisible();
    await expect(page.getByText(/\$5\.00 is going to/)).toContainText("Carbon removal");
    expect(capture.ledgerEntryId).toBeTruthy();
    lap("flight paid");
    return capture;
  });

  const tee = await test.step("tee: override the donation to $1.00, pay in sandbox", async () => {
    await addToCartAndCheckout(page, "Graphic tee 3-pack");
    const card = page.getByRole("region", { name: "Suggested donation" });
    await expect(card).toContainText("Fast fashion", { timeout: 30_000 });
    await expect(card).toContainText("Textile recycling");
    await expect(card).toContainText("$0.50"); // 2% of $24.99
    if (EXPECT_LLM) await expect(card).not.toContainText("rule-based fallback");

    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByLabel(/^Amount/).fill("1.00");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card).toContainText("You changed this from $0.50.");
    await expect(card).toContainText("$1.00");

    const capture = await payWithPayPal(page);
    await expect(page.getByRole("heading", { name: "Payment complete" })).toBeVisible();
    await expect(page.getByText(/\$1\.00 is going to/)).toContainText("Textile recycling");
    expect(capture.ledgerEntryId).toBeTruthy();
    lap("tee paid");
    return capture;
  });

  await test.step("ledger + impact page show both donations", async () => {
    const entries = await ledger(request);
    const f = entries.get(flight.ledgerEntryId!);
    const t = entries.get(tee.ledgerEntryId!);
    expect(f).toMatchObject({ causeId: "carbon_removal", category: "air_travel", amountCents: 500, userAction: "accepted", status: "pending_payout" });
    expect(t).toMatchObject({ causeId: "textile_recycling", category: "fast_fashion", amountCents: 100, userAction: "edited", status: "pending_payout" });
    if (EXPECT_LLM) {
      expect(["llm", "cache"]).toContain(f!.classificationSource);
      expect(["llm", "cache"]).toContain(t!.classificationSource);
    }

    await page.goto("/impact");
    await expect(page.getByRole("heading", { name: "Your impact" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Fast fashion · edited" }).first()).toBeVisible();
    lap("impact checked");
  });

  await test.step("admin: run the payout", async () => {
    await page.goto("/admin");
    // Next.js can keep a hidden copy of a route mounted, so match by label/role (visible only), not by id.
    await expect(page.getByRole("heading", { name: "Payouts" })).toBeVisible();
    // The header badge shows PAYOUT_MODE; batch badges below can belong to older batches.
    const header = page.getByRole("heading", { name: "Payouts" }).locator("xpath=..");
    const simulatedMode = await header.getByText("SIMULATED", { exact: true }).isVisible();

    await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
    await page.getByRole("button", { name: "Apply token" }).click();

    page.once("dialog", (d) => d.accept()); // "Run payout now?" confirm
    const runRes = page.waitForResponse((r) => r.url().endsWith("/api/payouts/run") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Run payout" }).click();
    const res = await runRes;
    expect(res.ok(), `payouts/run returned ${res.status()}: ${await res.text()}`).toBeTruthy();
    const batch = (await res.json()) as Batch;

    // Both of this run's donations are in the batch.
    const paidIds = batch.items.flatMap((i) => i.ledgerEntryIds);
    expect(paidIds).toContain(flight.ledgerEntryId);
    expect(paidIds).toContain(tee.ledgerEntryId);

    const section = page.getByRole("region", { name: "Payout batch" });
    await expect(section.getByRole("heading", { name: "Payout batch" })).toBeVisible();
    if (simulatedMode) {
      expect(batch.mode).toBe("simulated");
      await expect(section.getByText("SIMULATED", { exact: true })).toBeVisible();
    } else {
      expect(batch.mode).toBe("sandbox");
      expect(batch.paypalPayoutBatchId).toBeTruthy();
      expect(["PENDING", "PROCESSING", "SUCCESS"]).toContain(batch.status);
    }
    lap(`payout run (${batch.mode}, ${batch.status})`);

    // Sandbox payouts settle a few seconds later; "Refresh status" reconciles the ledger.
    const settled = simulatedMode ? "simulated_paid_out" : "paid_out";
    await expect
      .poll(
        async () => {
          const refresh = section.getByRole("button", { name: "Refresh status" });
          if (await refresh.isEnabled().catch(() => false)) {
            await refresh.click();
            // PayPal's status call can take a while; the button disappears once the batch is final.
            await expect(page.getByRole("status")).not.toContainText("Refreshing status…", { timeout: 60_000 });
          }
          const e = await ledger(request);
          return [e.get(flight.ledgerEntryId!)?.status, e.get(tee.ledgerEntryId!)?.status];
        },
        { timeout: 120_000, intervals: [5_000, 10_000, 15_000] },
      )
      .toEqual([settled, settled]);
    lap("payout settled");
  });

  const total = (Date.now() - started) / 1000;
  test.info().annotations.push({ type: "timing", description: `${timings.join(" · ")} · total ${total.toFixed(1)}s` });
  console.log(`A6 timings → ${timings.join(" · ")}`);
});

async function setChip(page: Page, group: string, name: RegExp, on: boolean) {
  const chip = page.getByRole("group", { name: group }).getByRole("button", { name });
  if ((await chip.getAttribute("aria-pressed")) !== String(on)) await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", String(on));
}

async function addToCartAndCheckout(page: Page, productName: string) {
  await page.goto("/");
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: productName }) });
  await card.getByRole("button", { name: "Add to cart" }).click();
  const cart = page.locator("#cart");
  await expect(cart).toContainText(productName);
  await expect(cart.getByRole("heading")).toHaveText("Cart (1)");
  await cart.getByRole("link", { name: "Checkout" }).click();
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
}

async function ledger(request: APIRequestContext): Promise<Map<string, LedgerEntry>> {
  const res = await request.get("/api/ledger");
  expect(res.ok()).toBeTruthy();
  const { entries } = (await res.json()) as { entries: LedgerEntry[] };
  return new Map(entries.map((e) => [e.id, e]));
}

/** Clicks the PayPal button, approves in the sandbox popup, and returns our capture response. */
async function payWithPayPal(page: Page): Promise<Capture> {
  const button = page.locator("paypal-button").first();
  await expect(button).toBeVisible({ timeout: 60_000 });
  const captured = page.waitForResponse(
    (r) => r.url().endsWith("/api/checkout/capture") && r.request().method() === "POST",
    { timeout: 240_000 },
  );
  const popupOpened = page.waitForEvent("popup", { timeout: 60_000 });
  await button.click();
  const popup = await popupOpened;
  await approveInSandbox(popup);

  const res = await captured;
  expect(res.ok(), `capture returned ${res.status()}: ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as Capture;
  expect(body.status).toBe("COMPLETED");
  return body;
}

/**
 * PayPal's sandbox checkout (web SDK v6 popup): email → Next → password → Log In → review → pay.
 * The second order in a run may reuse the login. The buyer must be a sandbox *personal* account:
 * the merchant's own account gets "This PayPal account is associated with the merchant".
 */
async function approveInSandbox(popup: Page) {
  await popup.waitForLoadState("domcontentloaded");
  const email = popup.getByRole("textbox", { name: "Email or mobile number" });
  const password = popup.getByRole("textbox", { name: "Password" });
  const pay = popup
    .getByRole("button", { name: /^(Complete Purchase|Pay Now|Pay|Agree & Pay|Continue to Review Order|Continue)$/ })
    .or(popup.locator('#payment-submit-btn, [data-id="payment-submit-btn"], [data-testid="submit-button-initial"]'))
    .first();
  const selfPay = popup.getByText("associated with the merchant you're trying to pay");

  await expect(email.or(password).or(pay)).toBeVisible({ timeout: 90_000 });
  if (await email.isVisible()) {
    await email.fill(BUYER_EMAIL);
    await popup.getByRole("button", { name: "Next" }).click();
    await expect(password).toBeVisible();
  }
  if (await password.isVisible()) {
    await password.fill(BUYER_PASSWORD);
    await popup.getByRole("button", { name: "Log In" }).click();
  }

  await expect(pay.or(selfPay)).toBeVisible({ timeout: 90_000 });
  if (await selfPay.isVisible()) {
    throw new Error("PAYPAL_SANDBOX_BUYER_EMAIL is the merchant's own sandbox account. Use a sandbox personal (buyer) account.");
  }
  await expect(pay).toBeEnabled();
  await pay.click();
  await popup.waitForEvent("close", { timeout: 90_000 });
}
