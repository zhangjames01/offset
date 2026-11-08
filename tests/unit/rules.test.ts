// Rules classifier (A3): keyword fallback, no network.
import { describe, expect, test } from "vitest";
import { type CartItem, LOW_CONFIDENCE_THRESHOLD, LlmClassification } from "@/contracts";
import { RULES_CONFIDENCE, rulesClassify } from "@/lib/classifier/rules";
import { mockCatalog } from "@/lib/mocks";

const item = (name: string, description = "", unitPriceCents = 1000, quantity = 1): CartItem => ({
  productId: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  description,
  unitPriceCents,
  quantity,
});
const one = (name: string, description = "") => rulesClassify({ items: [item(name, description)] });

describe("rulesClassify", () => {
  test.each(mockCatalog.products.map((p) => [p.id, p] as const))("demo product %s → expected category", (_, p) => {
    const got = rulesClassify({ items: [item(p.name, p.description, p.priceCents)] });
    expect(LlmClassification.parse(got)).toEqual(got);
    expect(got.category).toBe(p.expectedCategory);
    // The gift card is the low-confidence demo case; everything else must clear the bar.
    expect(got.confidence < LOW_CONFIDENCE_THRESHOLD).toBe(p.id === "gift-card-50");
  });

  test.each([
    ["Round-trip airfare SFO to SEA", "", "air_travel"],
    ["United Airlines ticket", "", "air_travel"],
    ["BOS → ORD", "Basic economy", "air_travel"],
    ["Summer dress", "Polyester, from a trend brand", "fast_fashion"],
    ["Hoodie", "", "fast_fashion"],
    ["Pizza night", "Large pepperoni pizza, delivered", "food_delivery"],
    ["DoorDash order", "", "food_delivery"],
    ["K-Cup variety", "72 coffee pods", "single_use_packaging"],
    ["Paper plates", "Disposable plates, 200 count", "single_use_packaging"],
    ["Desk lamp", "LED, adjustable arm", "general"],
  ] as const)("%s → %s", (name, description, category) => {
    expect(one(name, description).category).toBe(category);
  });

  test("not fooled by near-misses", () => {
    expect(one("Furniture delivery", "Sofa delivered to your door").category).toBe("general"); // no food
    expect(one("Graphic tee 3-pack", "").category).toBe("fast_fashion"); // "3-pack" isn't packaging
    expect(one("Snack box", "Snacks for the office").category).toBe("general"); // no delivery
  });

  test("mixed cart: the category with the most dollars wins", () => {
    const got = rulesClassify({
      items: [item("Hoodie", "", 4000), item("Flight to Denver", "", 20000), item("Novel", "", 1500)],
    });
    expect(got).toMatchObject({ category: "air_travel", confidence: RULES_CONFIDENCE.dominant });
    expect(got.reason).toContain("Flight to Denver");
  });

  test("quantity counts toward the dollar weight", () => {
    const got = rulesClassify({ items: [item("Hoodie", "", 3000, 1), item("Disposable cups", "", 1000, 5)] });
    expect(got.category).toBe("single_use_packaging");
  });

  test("a category under half the cart still wins, at the threshold", () => {
    const got = rulesClassify({ items: [item("Hoodie", "", 1000), item("Desk lamp", "", 9000)] });
    expect(got).toMatchObject({ category: "fast_fashion", confidence: RULES_CONFIDENCE.partial });
    expect(got.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD);
  });

  test("gift cards are low confidence only when they're most of the cart", () => {
    expect(one("Store gift card").confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    const mostlyLamp = rulesClassify({ items: [item("Gift card", "", 1000), item("Desk lamp", "", 9000)] });
    expect(mostlyLamp).toMatchObject({ category: "general", confidence: RULES_CONFIDENCE.general });
  });

  test("long names are clipped so the reason stays within the contract", () => {
    const got = one(`Flight ${"x".repeat(400)}`);
    expect(got.reason.length).toBeLessThanOrEqual(300);
    expect(LlmClassification.safeParse(got).success).toBe(true);
  });
});
