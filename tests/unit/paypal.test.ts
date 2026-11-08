
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  centsToUsd,
  createPayPalOrder,
} from "@/lib/paypal/client";

describe("PayPal amount formatting", () => {
  test("converts cents to USD", () => {
    expect(centsToUsd(100)).toBe("1.00");
    expect(centsToUsd(1050)).toBe("10.50");
    expect(centsToUsd(99)).toBe("0.99");
    expect(centsToUsd(0)).toBe("0.00");
  });

  test("rejects invalid amounts", () => {
    expect(() => centsToUsd(-1)).toThrow();
    expect(() => centsToUsd(1.5)).toThrow();
    expect(() => centsToUsd(Number.NaN)).toThrow();
  });
});

describe("PayPal order line items", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-client-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-client-secret");

    fetchMock.mockReset();

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-access-token",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "PAYPAL-ORDER-123",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function getOrderRequest() {
    const [url, options] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];

    const payload = JSON.parse(options.body as string);

    return { url, options, payload };
  }

  test("includes products and donation as line items", async () => {
    const orderId = await createPayPalOrder(
      [
        {
          name: "Demo T-Shirt",
          unitPriceCents: 2500,
          quantity: 2,
        },
      ],
      200,
      "ord_test_123",
    );

    expect(orderId).toBe("PAYPAL-ORDER-123");

    const { payload } = getOrderRequest();
    const purchaseUnit = payload.purchase_units[0];

    expect(purchaseUnit.items).toEqual([
      {
        name: "Demo T-Shirt",
        quantity: "2",
        category: "PHYSICAL_GOODS",
        unit_amount: {
          currency_code: "USD",
          value: "25.00",
        },
      },
      {
        name: "DONATION",
        quantity: "1",
        category: "DONATION",
        unit_amount: {
          currency_code: "USD",
          value: "2.00",
        },
      },
    ]);
  });

  test("amount and item_total equal the sum of line items", async () => {
    await createPayPalOrder(
      [
        {
          name: "Demo T-Shirt",
          unitPriceCents: 2500,
          quantity: 2,
        },
        {
          name: "Sticker",
          unitPriceCents: 300,
          quantity: 1,
        },
      ],
      200,
      "ord_total_test",
    );

    const { payload } = getOrderRequest();
    const purchaseUnit = payload.purchase_units[0];

    // 2500 * 2 + 300 + 200 = 5500 cents
    expect(purchaseUnit.amount.value).toBe("55.00");
    expect(purchaseUnit.amount.breakdown.item_total.value)
      .toBe("55.00");
    expect(purchaseUnit.amount.currency_code).toBe("USD");
  });

  test("omits donation item when donation is removed", async () => {
    await createPayPalOrder(
      [
        {
          name: "Demo T-Shirt",
          unitPriceCents: 2500,
          quantity: 1,
        },
      ],
      0,
      "ord_no_donation",
    );

    const { payload } = getOrderRequest();
    const purchaseUnit = payload.purchase_units[0];

    expect(purchaseUnit.items).toHaveLength(1);
    expect(purchaseUnit.items[0].category)
      .toBe("PHYSICAL_GOODS");
    expect(purchaseUnit.amount.value).toBe("25.00");
    expect(purchaseUnit.amount.breakdown.item_total.value)
      .toBe("25.00");
  });

  test("uses localOrderId as PayPal-Request-Id", async () => {
    await createPayPalOrder(
      [
        {
          name: "Demo T-Shirt",
          unitPriceCents: 2500,
          quantity: 1,
        },
      ],
      100,
      "ord_stable_retry_key",
    );

    const { options } = getOrderRequest();

    expect(
      (options.headers as Record<string, string>)[
        "PayPal-Request-Id"
      ],
    ).toBe("ord_stable_retry_key");
  });

  test("rejects invalid donation amounts before calling PayPal", async () => {
    await expect(
      createPayPalOrder(
        [
          {
            name: "Demo T-Shirt",
            unitPriceCents: 2500,
            quantity: 1,
          },
        ],
        -100,
        "ord_invalid",
      ),
    ).rejects.toThrow("Invalid donation amount");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
