// Client-side calls to our API routes. Responses are zod-parsed; errors use the API's message.
import {
  ApiError,
  CaptureResponse,
  CreateOrderResponse,
  type CreateOrderRequest,
} from "@/contracts";

type Schema<T> = { parse: (v: unknown) => T };

export async function postJson<T>(url: string, body: unknown, schema: Schema<T>, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return readJson(res, schema);
}

export async function getJson<T>(url: string, schema: Schema<T>): Promise<T> {
  return readJson(await fetch(url, { cache: "no-store" }), schema);
}

async function readJson<T>(res: Response, schema: Schema<T>): Promise<T> {
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
