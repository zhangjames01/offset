"use client";

import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import { cartReducer, emptyCart, type Cart, type CartAction } from "@/lib/cart";

const STORAGE_KEY = "offset.cart.v1";
// Placeholder id until localStorage has been read. Never saved.
const PENDING_ID = "cart_pending";

type CartContextValue = { cart: Cart; dispatch: (action: CartAction) => void };
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, dispatch] = useReducer(cartReducer, undefined, () => emptyCart(PENDING_ID));

  // Restore after mount (localStorage isn't available during SSR).
  useEffect(() => {
    let restored: Cart | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) restored = JSON.parse(raw) as Cart;
    } catch {
      // Storage blocked or corrupt: start empty.
    }
    dispatch({ type: "load", cart: restored?.lines && restored.id !== PENDING_ID ? restored : emptyCart() });
  }, []);

  useEffect(() => {
    // Skip until the restore has landed, so the empty placeholder never overwrites a saved cart
    // (React Strict Mode runs these effects twice in dev).
    if (cart.id === PENDING_ID) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Non-fatal: cart just won't survive a reload.
    }
  }, [cart]);

  return <CartContext.Provider value={{ cart, dispatch }}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
