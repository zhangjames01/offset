
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

export async function createPayPalOrder(
  totalCents: number,
  localOrderId: string,
): Promise<string> {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("PayPal order total must be positive");
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
            },
          },
        ],
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`PayPal order creation failed: ${response.status}`);
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
