// Cart state for the storefront (H2). Pure functions so they're unit-testable.
import type { CartItem, ClassifyRequest, Product } from "@/contracts";

export type CartLine = { product: Product; quantity: number };
export type Cart = { id: string; lines: CartLine[] };

export const MAX_QTY = 9;

export type CartAction =
  | { type: "add"; product: Product }
  | { type: "setQty"; productId: string; quantity: number }
  | { type: "remove"; productId: string }
  | { type: "clear" }
  | { type: "load"; cart: Cart };

export function newCartId(): string {
  return `cart_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyCart(id = newCartId()): Cart {
  return { id, lines: [] };
}

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case "add": {
      const existing = cart.lines.find((l) => l.product.id === action.product.id);
      if (existing) {
        return cartReducer(cart, {
          type: "setQty",
          productId: action.product.id,
          quantity: existing.quantity + 1,
        });
      }
      return { ...cart, lines: [...cart.lines, { product: action.product, quantity: 1 }] };
    }
    case "setQty": {
      const quantity = Math.min(MAX_QTY, Math.floor(action.quantity));
      if (quantity < 1) return cartReducer(cart, { type: "remove", productId: action.productId });
      return {
        ...cart,
        lines: cart.lines.map((l) => (l.product.id === action.productId ? { ...l, quantity } : l)),
      };
    }
    case "remove":
      return { ...cart, lines: cart.lines.filter((l) => l.product.id !== action.productId) };
    case "clear":
      // New id so a fresh cart never reuses a cached classification.
      return emptyCart();
    case "load":
      return action.cart;
  }
}

export function itemCount(cart: Cart): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}

/** Display-only subtotal. The server re-prices from the catalog at create-order. */
export function subtotalCents(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);
}

/** Builds the POST /api/classify body (used by H3). Never includes caps or expectedCategory. */
export function toClassifyRequest(cart: Cart, userId = "demo-user"): ClassifyRequest {
  const items: CartItem[] = cart.lines.map((l) => ({
    productId: l.product.id,
    name: l.product.name,
    description: l.product.description,
    unitPriceCents: l.product.priceCents,
    quantity: l.quantity,
  }));
  return { cartId: cart.id, currency: "USD", items, subtotalCents: subtotalCents(cart), userId };
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
