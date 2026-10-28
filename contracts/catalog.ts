import { z } from "zod";
import { Category, Cents } from "./common";

/** GET /api/catalog item. Prices are re-read from here on the server; never trust client prices. */
export const Product = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  priceCents: Cents,
  imageUrl: z.string().optional(),
  /**
   * Test label only (which demo case this product exercises).
   * The classifier must NEVER read this field.
   */
  expectedCategory: Category.optional(),
});
export type Product = z.infer<typeof Product>;

export const CatalogResponse = z.object({
  products: z.array(Product),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;
