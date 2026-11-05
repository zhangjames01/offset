// Prompt + schema (A2): the JSON schema sent to the API must stay in sync with the zod contract.
import { describe, expect, test } from "vitest";
import { Category, LlmClassification, type ClassifyRequest } from "@/contracts";
import { OUTPUT_SCHEMA, cartPrompt } from "@/lib/classifier/prompt";

const cart: ClassifyRequest = {
  cartId: "cart_t",
  currency: "USD",
  userId: "demo-user",
  subtotalCents: 27399,
  items: [
    { productId: "flight-jfk-lax", name: "JFK → LAX economy", description: "One-way\nflight", unitPriceCents: 24900, quantity: 1 },
    { productId: "tee-3pack", name: "Graphic tee 3-pack", description: "", unitPriceCents: 2499, quantity: 1 },
  ],
};

describe("OUTPUT_SCHEMA", () => {
  test("matches LlmClassification keys and the Category enum", () => {
    expect([...OUTPUT_SCHEMA.required].sort()).toEqual(Object.keys(LlmClassification.shape).sort());
    expect(Object.keys(OUTPUT_SCHEMA.properties).sort()).toEqual(Object.keys(LlmClassification.shape).sort());
    expect(OUTPUT_SCHEMA.properties.category.enum).toEqual(Category.options);
  });

  test("uses no keywords the structured-outputs API rejects", () => {
    expect(JSON.stringify(OUTPUT_SCHEMA)).not.toMatch(/minimum|maximum|minLength|maxLength|multipleOf/);
  });
});

describe("cartPrompt()", () => {
  test("lists each line with its total, never the productId", () => {
    const p = cartPrompt(cart);
    expect(p).toContain('- 1 × "JFK → LAX economy" — One-way flight ($249.00)');
    expect(p).toContain('- 1 × "Graphic tee 3-pack" ($24.99)');
    expect(p).toContain("Subtotal: $273.99");
    expect(p).not.toContain("flight-jfk-lax");
  });

  test("caps very long carts", () => {
    const big = { ...cart, items: Array.from({ length: 25 }, () => cart.items[1]) };
    const p = cartPrompt(big);
    expect(p.match(/^- 1 ×/gm)).toHaveLength(20);
    expect(p).toContain("…and 5 more items");
  });
});
