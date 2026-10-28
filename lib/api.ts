/**
 * Shared helpers for every route handler: contract-shaped JSON, the standard
 * error shape, body validation, and the mode switches from .env.
 */
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { ErrorCode } from "@/contracts";

// ---------- modes ----------

export type LlmMode = "mock" | "live" | "rules";
export type PaypalMode = "mock" | "sandbox";
export type PayoutModeEnv = "sandbox" | "simulated";

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

export const modes = {
  llm: () => pick<LlmMode>(process.env.LLM_MODE, ["mock", "live", "rules"], "mock"),
  paypal: () => pick<PaypalMode>(process.env.PAYPAL_MODE, ["mock", "sandbox"], "mock"),
  payout: () => pick<PayoutModeEnv>(process.env.PAYOUT_MODE, ["sandbox", "simulated"], "simulated"),
};

export function payoutThresholdCents(): number {
  const n = Number(process.env.PAYOUT_THRESHOLD_CENTS);
  return Number.isInteger(n) && n > 0 ? n : 500;
}

// ---------- responses ----------

export class ApiFailure extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function fail(code: ErrorCode, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Validate an outgoing payload against its contract before sending it.
 * A mismatch is a bug on our side, so it returns 500 instead of bad data.
 */
export function ok<S extends z.ZodType>(schema: S, data: z.input<S>, status = 200): Response {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error("[contract] response failed validation", parsed.error.issues);
    return fail("INTERNAL", "Response did not match its contract", 500);
  }
  return Response.json(parsed.data, { status });
}

/** Parse + validate a JSON body. Throws ApiFailure(400) on bad input. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiFailure("VALIDATION_ERROR", "Body must be valid JSON", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new ApiFailure("VALIDATION_ERROR", `${where}${first?.message ?? "Invalid body"}`, 400);
  }
  return parsed.data;
}

/** Wrap a handler so thrown ApiFailures become the standard error shape. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      // Let Next.js control-flow errors (prerender bailout, notFound, redirect) through.
      unstable_rethrow(err);
      if (err instanceof ApiFailure) return fail(err.code, err.message, err.status);
      console.error(err);
      return fail("INTERNAL", "Unexpected server error", 500);
    }
  };
}

export function notImplemented(what: string, task: string): never {
  throw new ApiFailure("NOT_IMPLEMENTED", `${what} is not implemented yet (${task}). Use mock mode.`, 501);
}

// ---------- admin ----------

/** x-admin-token must match ADMIN_TOKEN. Outside production, an unset ADMIN_TOKEN accepts "dev-admin". */
export function requireAdmin(req: Request): void {
  const expected =
    process.env.ADMIN_TOKEN || (process.env.NODE_ENV !== "production" ? "dev-admin" : undefined);
  if (!expected || req.headers.get("x-admin-token") !== expected) {
    throw new ApiFailure("UNAUTHORIZED", "Missing or invalid x-admin-token", 401);
  }
}
