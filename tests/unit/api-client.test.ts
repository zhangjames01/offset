// createOrder resends the identical body while the server reports CHECKOUT_CONFLICT (J3's in-flight 409).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateOrderRequest } from "@/contracts";
import { ApiRequestError, createOrder, errorCode } from "@/lib/api-client";

const body: CreateOrderRequest = {
  cartId: "cart_1",
  items: [{ productId: "tee-3pack", quantity: 1 }],
  donation: { classificationId: "cls_1", donationCents: 50, causeId: "textile_recycling", userAction: "accepted" },
};
const conflict = () =>
  new Response(JSON.stringify({ error: { code: "CHECKOUT_CONFLICT", message: "Checkout is being processed. Please retry shortly." } }), { status: 409 });
const created = () => new Response(JSON.stringify({ paypalOrderId: "PAYPAL-1", localOrderId: "ord_1" }), { status: 200 });
const noWait = async () => {};

afterEach(() => vi.unstubAllGlobals());

describe("createOrder", () => {
  it("resends the same body after a conflict and returns the existing order", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(conflict()).mockResolvedValueOnce(conflict()).mockResolvedValueOnce(created());
    vi.stubGlobal("fetch", fetch);
    await expect(createOrder(body, { wait: noWait })).resolves.toEqual({ paypalOrderId: "PAYPAL-1", localOrderId: "ord_1" });
    expect(fetch).toHaveBeenCalledTimes(3);
    const sent = fetch.mock.calls.map((c) => c[1].body);
    expect(new Set(sent).size).toBe(1); // identical request each time
  });

  it("gives up after the retry delays and surfaces the code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => conflict()));
    const err = await createOrder(body, { delaysMs: [1, 1], wait: noWait }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(errorCode(err)).toBe("CHECKOUT_CONFLICT");
  });

  it("doesn't retry other errors", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "PAYPAL_CREATE_FAILED", message: "Unable to create PayPal order" } }), { status: 502 }),
    );
    vi.stubGlobal("fetch", fetch);
    const err = await createOrder(body, { wait: noWait }).catch((e) => e);
    expect(errorCode(err)).toBe("PAYPAL_CREATE_FAILED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
