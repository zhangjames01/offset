// POST /api/classify — owner: James (A2/A3). Cart → ClassifyResponse.
// live: cache → LLM → rules fallback (never CLASSIFY_FAILED). rules: keyword classifier only.
import { ClassifyRequest, ClassifyResponse } from "@/contracts";
import { ApiFailure, handle, modes, ok, parseBody } from "@/lib/api";
import { classify, liveDeps, rulesDeps } from "@/lib/classifier";
import { mockClassifyByProduct, mockUnknownProduct } from "@/lib/mocks";
import { store } from "@/lib/mock-store";
import { clientIp } from "@/lib/rate-limit";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/db";
import { hashCart } from "@/lib/checkout/cart-hash";
import { mockCatalog } from "@/lib/mocks";

export const POST = handle(async (req: Request) => {
  const cart = await parseBody(req, ClassifyRequest);
  const mode = modes.llm();

  if (mode === "live") return ok(ClassifyResponse, await classify(cart, liveDeps(clientIp(req))));
  if (mode === "rules") return ok(ClassifyResponse, await classify(cart, rulesDeps()));

  // Mock: use the canned response for the highest-priced line in the cart.
  const top = [...cart.items].sort(
    (a, b) => b.unitPriceCents * b.quantity - a.unitPriceCents * a.quantity,
  )[0];

  const canned = mockClassifyByProduct[top.productId] ?? mockUnknownProduct;

  // Generate a unique classification ID for each checkout.
  // Canned IDs would otherwise collide in Neon.
  const result = {
    ...canned,
    classificationId: `cls_${randomUUID()}`,
  };

  // Save to the existing mock store for compatibility.
  store().classifications.set(result.classificationId, result);

  if (modes.paypal() === "sandbox") {
    const prisma = getPrisma();

    const prices = new Map(
      mockCatalog.products.map((p) => [p.id, p.priceCents]),
    );

    const trustedItems = cart.items.map((item) => {
      const priceCents = prices.get(item.productId);

      if (priceCents === undefined) {
        throw new ApiFailure(
          "VALIDATION_ERROR",
          `Unknown productId: ${item.productId}`,
          400,
        );
      }

      return {
        productId: item.productId,
        quantity: item.quantity,
        priceCents,
      };
    });

    const cartHash = hashCart(trustedItems);

    await prisma.classificationApproval.create({
      data: {
        id: result.classificationId,
        userId: cart.userId,
        cartId: cart.cartId,
        cartHash,
        category: result.category,
        causeId: result.causeId,
        suggestedDonationCents: result.suggestedDonationCents,
        donationCents: result.donationCents,
        source: result.source,
      },
    });
  }

  return ok(ClassifyResponse, result);

});
