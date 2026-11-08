import { describe, expect, it } from "vitest";
import { ClassifyRequest } from "@/contracts";
import { cartReducer, emptyCart, itemCount, MAX_QTY, removePaid, subtotalCents, toClassifyRequest } from "@/lib/cart";
import { mockCatalog } from "@/lib/mocks";

const [flight, tee] = mockCatalog.products;

describe("cart", () => {
  it("adds, increments, and totals in cents", () => {
    let c = emptyCart("cart_t");
    c = cartReducer(c, { type: "add", product: flight });
    c = cartReducer(c, { type: "add", product: tee });
    c = cartReducer(c, { type: "add", product: tee });
    expect(itemCount(c)).toBe(3);
    expect(subtotalCents(c)).toBe(flight.priceCents + 2 * tee.priceCents);
  });

  it("clamps quantity and removes at zero", () => {
    let c = cartReducer(emptyCart("cart_t"), { type: "add", product: tee });
    c = cartReducer(c, { type: "setQty", productId: tee.id, quantity: 99 });
    expect(c.lines[0].quantity).toBe(MAX_QTY);
    c = cartReducer(c, { type: "setQty", productId: tee.id, quantity: 0 });
    expect(c.lines).toHaveLength(0);
  });

  it("removePaid keeps items added after the order, under a new id", () => {
    let c = cartReducer(emptyCart("cart_t"), { type: "add", product: flight });
    c = cartReducer(c, { type: "add", product: tee });
    c = cartReducer(c, { type: "add", product: tee });
    const left = removePaid(c, [{ productId: flight.id, quantity: 1 }, { productId: tee.id, quantity: 1 }]);
    expect(left.lines.map((l) => [l.product.id, l.quantity])).toEqual([[tee.id, 1]]);
    expect(left.id).not.toBe("cart_t");
  });

  it("clear issues a new cart id", () => {
    const c = cartReducer(emptyCart("cart_t"), { type: "clear" });
    expect(c.id).not.toBe("cart_t");
  });

  it("builds a contract-valid ClassifyRequest without test labels", () => {
    const c = cartReducer(emptyCart("cart_t"), { type: "add", product: flight });
    const req = ClassifyRequest.parse(toClassifyRequest(c));
    expect(req.subtotalCents).toBe(flight.priceCents);
    expect(JSON.stringify(req)).not.toContain("expectedCategory");
  });
});
