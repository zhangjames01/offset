// Client-side calls to our API routes. Responses are zod-parsed; errors use the API's message.
import {
  ApiError,
  CaptureResponse,
  CreateOrderResponse,
  type CreateOrderRequest,
  type ErrorCode,
} from "@/contracts";

/** An error response from our API, with its contract error code when the body had one. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export const errorCode = (e: unknown): ErrorCode | null => (e instanceof ApiRequestError ? e.code : null);

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
    throw err.success
      ? new ApiRequestError(err.data.error.message, err.data.error.code, res.status)
      : new ApiRequestError(`Request failed (${res.status})`, null, res.status);
  }
  return schema.parse(json);
}

/** Waits between resends while the same checkout is still being processed (409 CHECKOUT_CONFLICT). */
export const CONFLICT_RETRY_DELAYS_MS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Resending the identical body is safe: the server keys attempts on the request hash, so once the
 * first attempt finishes it returns that same PayPal order instead of creating another.
 */
export async function createOrder(
  body: CreateOrderRequest,
  opts: { delaysMs?: number[]; wait?: (ms: number) => Promise<void> } = {},
) {
  const { delaysMs = CONFLICT_RETRY_DELAYS_MS, wait = sleep } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await postJson("/api/checkout/create-order", body, CreateOrderResponse);
    } catch (e) {
      if (errorCode(e) !== "CHECKOUT_CONFLICT" || attempt >= delaysMs.length) throw e;
      await wait(delaysMs[attempt]);
    }
  }
}

export function captureOrder(paypalOrderId: string) {
  return postJson("/api/checkout/capture", { paypalOrderId }, CaptureResponse);
}
