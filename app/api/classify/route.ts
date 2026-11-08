// POST /api/classify — owner: James (A2/A3). Cart → ClassifyResponse.
// live: cache → LLM → rules fallback (never CLASSIFY_FAILED). rules: keyword classifier only.
import { ClassifyRequest, ClassifyResponse } from "@/contracts";
import { handle, modes, ok, parseBody } from "@/lib/api";
import { classify, liveDeps, rulesDeps } from "@/lib/classifier";
import { mockClassifyByProduct, mockUnknownProduct } from "@/lib/mocks";
import { store } from "@/lib/mock-store";
import { clientIp } from "@/lib/rate-limit";

export const POST = handle(async (req: Request) => {
  const cart = await parseBody(req, ClassifyRequest);
  const mode = modes.llm();

  if (mode === "live") return ok(ClassifyResponse, await classify(cart, liveDeps(clientIp(req))));
  if (mode === "rules") return ok(ClassifyResponse, await classify(cart, rulesDeps()));

  // Mock: use the canned response for the highest-priced line in the cart.
  const top = [...cart.items].sort(
    (a, b) => b.unitPriceCents * b.quantity - a.unitPriceCents * a.quantity,
  )[0];
  const result = mockClassifyByProduct[top.productId] ?? mockUnknownProduct;

  store().classifications.set(result.classificationId, result);
  return ok(ClassifyResponse, result);
});
