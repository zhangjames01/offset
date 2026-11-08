
const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";

export function centsToUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Invalid amount in cents");
  }

  const dollars = Math.floor(cents / 100);
  const remainder = String(cents % 100).padStart(2, "0");

  return `${dollars}.${remainder}`;
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal Sandbox credentials are missing");
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`,
  ).toString("base64");

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`PayPal authentication failed: ${response.status}`);
  }

  const data: unknown = await response.json();

  if (
    !data ||
    typeof data !== "object" ||
    !("access_token" in data) ||
    typeof data.access_token !== "string"
  ) {
    throw new Error("Invalid PayPal authentication response");
  }

  return data.access_token;
}


export type PayPalOrderItem = {
  name: string;
  unitPriceCents: number;
  quantity: number;
};

type PayPalLineItem = {
  name: string;
  quantity: string;
  category?: "PHYSICAL_GOODS" | "DIGITAL_GOODS" | "DONATION";
  unit_amount: {
    currency_code: "USD";
    value: string;
  };
};

export async function createPayPalOrder(
  products: PayPalOrderItem[],
  donationCents: number,
  localOrderId: string,
): Promise<string> {
  if (products.length === 0) {
    throw new Error("PayPal order must contain products");
  }

  if (!Number.isSafeInteger(donationCents) || donationCents < 0) {
    throw new Error("Invalid donation amount");
  }

  let totalCents = donationCents;

  const items: PayPalLineItem[] = products.map((product) => {
    if (
      !product.name.trim() ||
      !Number.isSafeInteger(product.unitPriceCents) ||
      product.unitPriceCents < 0 ||
      !Number.isSafeInteger(product.quantity) ||
      product.quantity <= 0
    ) {
      throw new Error("Invalid PayPal product");
    }

    totalCents += product.unitPriceCents * product.quantity;

    return {
      name: product.name.slice(0, 127),
      quantity: String(product.quantity),
      category: "PHYSICAL_GOODS",
      unit_amount: {
        currency_code: "USD",
        value: centsToUsd(product.unitPriceCents),
      },
    };
  });

  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("Invalid PayPal order total");
  }

if (donationCents > 0) {
  items.push({
    name: "Optional charitable contribution",
    quantity: "1",
    unit_amount: {
      currency_code: "USD",
      value: centsToUsd(donationCents),
    },
  });
}

  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": localOrderId,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: localOrderId,
            amount: {
              currency_code: "USD",
              value: centsToUsd(totalCents),
              breakdown: {
                item_total: {
                  currency_code: "USD",
                  value: centsToUsd(totalCents),
                },
              },
            },
            items,
          },
        ],
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `PayPal order creation failed: ${response.status} ${details.slice(0, 500)}`,
    );
  }

  const data: unknown = await response.json();

  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    typeof data.id !== "string" ||
    !data.id
  ) {
    throw new Error("PayPal returned an invalid order ID");
  }

  return data.id;
}
