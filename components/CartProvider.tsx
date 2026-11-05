"use client";

import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { cartReducer, emptyCart, type Cart, type CartAction } from "@/lib/cart";

const STORAGE_KEY = "offset.cart.v1";

type CartContextValue = { cart: Cart; dispatch: (action: CartAction) => void };
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, dispatch] = useReducer(cartReducer, undefined, () => emptyCart("cart_pending"));
  const loaded = useRef(false);

  // Restore after mount (localStorage isn't available during SSR).
  useEffect(() => {
    let restored: Cart | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) restored = JSON.parse(raw) as Cart;
    } catch {
      // Storage blocked or corrupt: start empty.
    }
    dispatch({ type: "load", cart: restored?.lines ? restored : emptyCart() });
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
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
