
import { createHash } from "node:crypto";

type CartHashItem = {
  productId: string;
  quantity: number;
  priceCents: number;
};

export function hashCart(items: CartHashItem[]): string {
  const normalized = items
    .map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      priceCents: item.priceCents,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}
