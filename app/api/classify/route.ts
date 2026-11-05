// POST /api/classify — owner: James (A2/A3). Cart → ClassifyResponse.
import { ClassifyRequest, ClassifyResponse } from "@/contracts";
import { ApiFailure, handle, modes, notImplemented, ok, parseBody } from "@/lib/api";
import { LlmError, classify, liveDeps } from "@/lib/classifier";
import { mockClassifyByProduct, mockUnknownProduct } from "@/lib/mocks";
import { store } from "@/lib/mock-store";

export const POST = handle(async (req: Request) => {
  const cart = await parseBody(req, ClassifyRequest);
  const mode = modes.llm();

  if (mode === "live") {
    try {
      return ok(ClassifyResponse, await classify(cart, liveDeps()));
    } catch (err) {
      // A3 replaces this with the rules fallback (invalid_output / timeout / rate_limited).
      if (err instanceof LlmError) {
        // Details stay in the server log; the client gets a generic message.
        console.error(`[classify] ${err.kind}: ${err.message}`);
        throw new ApiFailure(
          "CLASSIFY_FAILED",
          "Unable to classify your purchase right now.",
          err.kind === "not_configured" ? 503 : 502,
        );
      }
      throw err;
    }
  }
  if (mode !== "mock") notImplemented(`LLM_MODE=${mode}`, "A3");

  // Mock: use the canned response for the highest-priced line in the cart.
  const top = [...cart.items].sort(
    (a, b) => b.unitPriceCents * b.quantity - a.unitPriceCents * a.quantity,
  )[0];
  const result = mockClassifyByProduct[top.productId] ?? mockUnknownProduct;

  store().classifications.set(result.classificationId, result);
  return ok(ClassifyResponse, result);
});
