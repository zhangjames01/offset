// POST /api/classify — owner: James (A2/A3). Cart → ClassifyResponse.
import { ClassifyRequest, ClassifyResponse } from "@/contracts";
import { handle, modes, notImplemented, ok, parseBody } from "@/lib/api";
import { mockClassifyByProduct, mockUnknownProduct } from "@/lib/mocks";
import { store } from "@/lib/mock-store";

export const POST = handle(async (req: Request) => {
  const cart = await parseBody(req, ClassifyRequest);

  if (modes.llm() !== "mock") notImplemented(`LLM_MODE=${modes.llm()}`, "A2/A3");

  // Mock: use the canned response for the highest-priced line in the cart.
  const top = [...cart.items].sort(
    (a, b) => b.unitPriceCents * b.quantity - a.unitPriceCents * a.quantity,
  )[0];
  const result = mockClassifyByProduct[top.productId] ?? mockUnknownProduct;

  store().classifications.set(result.classificationId, result);
  return ok(ClassifyResponse, result);
});
