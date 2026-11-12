
import { handle, ok } from "@/lib/api";
import { z } from "zod";

const HealthResponse = z.object({
  status: z.literal("ok"),
});

export const GET = handle(async () => {
  return ok(HealthResponse, { status: "ok" });
});
