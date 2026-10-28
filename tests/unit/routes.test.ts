// Route handlers called directly (no server) in mock mode.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ApiError,
  CaptureResponse,
  CatalogResponse,
  ClassifyResponse,
  CreateOrderResponse,
  LedgerResponse,
  PayoutBatch,
  Preferences,
} from "@/contracts";
import { resetStore } from "@/lib/mock-store";

// connection() needs a Next request scope; in unit tests it's a no-op.
vi.mock("next/server", () => ({ connection: async () => {} }));

import { GET as getCatalog } from "@/app/api/catalog/route";
import { POST as classify } from "@/app/api/classify/route";
import { GET as getPrefs, PUT as putPrefs } from "@/app/api/preferences/route";
import { POST as parsePrefs } from "@/app/api/preferences/parse/route";
import { POST as createOrder } from "@/app/api/checkout/create-order/route";
import { POST as capture } from "@/app/api/checkout/capture/route";
import { GET as getLedger } from "@/app/api/ledger/route";
import { POST as runPayouts } from "@/app/api/payouts/run/route";
import { GET as getPayout } from "@/app/api/payouts/[id]/route";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const flightCart = {
  cartId: "cart_t1",
  currency: "USD",
  userId: "demo-user",
  subtotalCents: 24900,
  items: [{ productId: "flight-jfk-lax", name: "JFK → LAX", description: "flight", unitPriceCents: 24900, quantity: 1 }],
};

const order = (donationCents: number, userAction = "accepted") => ({
  cartId: "cart_t1",
  items: [{ productId: "flight-jfk-lax", quantity: 1 }],
  donation: { classificationId: "cls_mock_01", donationCents, causeId: "carbon_removal", userAction },
});

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = ApiError.parse(await res.json());
  expect(body.error.code).toBe(code);
}

beforeEach(() => {
  resetStore();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

describe("mock mode routes", () => {
  test("GET /api/catalog", async () => {
    const res = await getCatalog();
    expect(CatalogResponse.parse(await res.json()).products).toHaveLength(6);
  });

  test("POST /api/classify returns the canned response for the priciest item", async () => {
    const res = await classify(post(flightCart));
    const body = ClassifyResponse.parse(await res.json());
    expect(body).toMatchObject({ category: "air_travel", donationCents: 500, adjustment: "per_order_max" });
  });

  test("POST /api/classify rejects a bad body with VALIDATION_ERROR", async () => {
    await expectError(await classify(post({ cartId: 1 })), 400, "VALIDATION_ERROR");
    await expectError(await classify(post("not json")), 400, "VALIDATION_ERROR");
  });

  test("checkout → capture → ledger → payout flow", async () => {
    const created = CreateOrderResponse.parse(await (await createOrder(post(order(500)))).json());

    const cap1 = CaptureResponse.parse(await (await capture(post({ paypalOrderId: created.paypalOrderId }))).json());
    expect(cap1.ledgerEntryId).not.toBeNull();

    // Idempotent: same result, no second ledger row.
    const cap2 = CaptureResponse.parse(await (await capture(post({ paypalOrderId: created.paypalOrderId }))).json());
    expect(cap2).toEqual(cap1);

    const ledger = LedgerResponse.parse(await (await getLedger()).json());
    expect(ledger.entries.filter((e) => e.id === cap1.ledgerEntryId)).toHaveLength(1);
    const carbon = ledger.balances.find((b) => b.causeId === "carbon_removal")!;
    expect(carbon.pendingCents).toBe(1000); // 500 seeded mock + 500 new

    const batch = PayoutBatch.parse(
      await (await runPayouts(post({ dryRun: false }, { "x-admin-token": "dev-admin" }))).json(),
    );
    expect(batch.mode).toBe("simulated");
    expect(batch.status).toBe("SIMULATED");
    expect(batch.items.map((i) => i.causeId)).toEqual(["carbon_removal"]);

    const after = LedgerResponse.parse(await (await getLedger()).json());
    expect(after.balances.find((b) => b.causeId === "carbon_removal")).toMatchObject({
      pendingCents: 0,
      paidOutCents: 1000,
    });
  });

  test("removed donation writes no ledger row", async () => {
    const created = CreateOrderResponse.parse(await (await createOrder(post(order(500, "removed")))).json());
    const cap = CaptureResponse.parse(await (await capture(post({ paypalOrderId: created.paypalOrderId }))).json());
    expect(cap.ledgerEntryId).toBeNull();
  });

  test("create-order rejects donations over the per-order max and unknown products", async () => {
    await expectError(await createOrder(post(order(900, "edited"))), 400, "VALIDATION_ERROR");
    const bad = { ...order(100), items: [{ productId: "nope", quantity: 1 }] };
    await expectError(await createOrder(post(bad)), 400, "VALIDATION_ERROR");
  });

  test("capture of an unknown order is NOT_FOUND", async () => {
    await expectError(await capture(post({ paypalOrderId: "NOPE" })), 404, "NOT_FOUND");
  });

  test("payouts/run requires the admin token", async () => {
    await expectError(await runPayouts(post({})), 401, "UNAUTHORIZED");
    vi.stubEnv("ADMIN_TOKEN", "s3cret");
    await expectError(await runPayouts(post({}, { "x-admin-token": "dev-admin" })), 401, "UNAUTHORIZED");
    expect((await runPayouts(post({ dryRun: true }, { "x-admin-token": "s3cret" }))).status).toBe(200);
  });

  test("sandbox payout batch settles on refresh via GET /api/payouts/:id", async () => {
    vi.stubEnv("PAYOUT_MODE", "sandbox");
    const batch = PayoutBatch.parse(
      await (await runPayouts(post({}, { "x-admin-token": "dev-admin" }))).json(),
    );
    expect(batch.status).toBe("PENDING");
    const ctx = { params: Promise.resolve({ id: batch.id }) };
    const refreshed = PayoutBatch.parse(await (await getPayout(new Request("http://test"), ctx)).json());
    expect(refreshed.status).toBe("SUCCESS");
    await expectError(
      await getPayout(new Request("http://test"), { params: Promise.resolve({ id: "nope" }) }),
      404,
      "NOT_FOUND",
    );
  });

  test("preferences GET / PUT / parse", async () => {
    const before = Preferences.parse(await (await getPrefs()).json());
    expect(before.userId).toBe("demo-user");

    const put = new Request("http://test/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...before, userId: undefined, updatedAt: undefined, perOrderMaxCents: 300 }),
    });
    expect(Preferences.parse(await (await putPrefs(put)).json()).perOrderMaxCents).toBe(300);
    expect(Preferences.parse(await (await getPrefs()).json()).perOrderMaxCents).toBe(300);

    const parsed = Preferences.parse(await (await parsePrefs(post({ rawText: "climate" }))).json());
    expect(parsed.rawText).toBe("climate");
  });
});

describe("real modes that aren't built yet return 501", () => {
  test("LLM_MODE=live", async () => {
    vi.stubEnv("LLM_MODE", "live");
    await expectError(await classify(post(flightCart)), 501, "NOT_IMPLEMENTED");
    await expectError(await parsePrefs(post({ rawText: "x" })), 501, "NOT_IMPLEMENTED");
  });

  test("PAYPAL_MODE=sandbox", async () => {
    vi.stubEnv("PAYPAL_MODE", "sandbox");
    await expectError(await createOrder(post(order(100))), 501, "NOT_IMPLEMENTED");
    await expectError(await capture(post({ paypalOrderId: "X" })), 501, "NOT_IMPLEMENTED");
  });
});
