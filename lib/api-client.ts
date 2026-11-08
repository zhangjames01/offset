// Client-side calls to our API routes (classify, checkout). Responses are zod-parsed; errors use the API's message.
import {
  ApiError,
  CaptureResponse,
  CreateOrderResponse,
  type CreateOrderRequest,
} from "@/contracts";

export async function postJson<T>(url: string, body: unknown, schema: { parse: (v: unknown) => T }): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw new Error(err.success ? err.data.error.message : `Request failed (${res.status})`);
  }
  return schema.parse(json);
}

export function createOrder(body: CreateOrderRequest) {
  return postJson("/api/checkout/create-order", body, CreateOrderResponse);
}

export function captureOrder(paypalOrderId: string) {
  return postJson("/api/checkout/capture", { paypalOrderId }, CaptureResponse);
}
