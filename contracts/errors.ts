import { z } from "zod";

/** Every route returns this shape with a 4xx/5xx status on failure. */
export const ErrorCode = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "CLASSIFY_FAILED",
  "PAYPAL_CREATE_FAILED",
  "PAYPAL_CAPTURE_FAILED",
  "PAYOUT_FAILED",
  "NOT_IMPLEMENTED", // real mode selected but not built yet (A2 / J3 / J6)
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
