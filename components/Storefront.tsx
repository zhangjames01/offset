"use client";

import { useEffect, useState } from "react";
import { CatalogResponse, type Product } from "@/contracts";
import { formatCents, itemCount, MAX_QTY, subtotalCents } from "@/lib/cart";
import { useCart } from "./CartProvider";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; products: Product[] };

export function Storefront() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Catalog failed (${res.status})`);
        return CatalogResponse.parse(await res.json());
      })
      .then((data) => !cancelled && setLoad({ status: "ok", products: data.products }))
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: err instanceof Error ? err.message : "Catalog failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 p-4 sm:p-8 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold">Offset Store</h1>
        <p className="mt-1 text-sm text-zinc-500">Add items, then check out with an optional matched donation.</p>
        <div className="mt-6">
          {load.status === "loading" && <p className="text-zinc-500">Loading products…</p>}
          {load.status === "error" && <p className="text-red-600">{load.message}</p>}
          {load.status === "ok" && (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {load.products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </ul>
          )}
        </div>
      </section>
      <CartPanel />
    </main>
  );
}

function ProductCard({ product }: { product: Product }) {
  const { dispatch } = useCart();
  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">{product.name}</h2>
      <p className="mt-1 flex-1 text-sm text-zinc-500">{product.description}</p>
      <div className="mt-4 flex items-center justify-between">
        <span className="font-semibold tabular-nums">{formatCents(product.priceCents)}</span>
        <button
          type="button"
          onClick={() => dispatch({ type: "add", product })}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add to cart
        </button>
      </div>
    </li>
  );
}

function CartPanel() {
  const { cart, dispatch } = useCart();
  const count = itemCount(cart);

  return (
    <aside className="h-fit rounded-lg border border-zinc-200 p-4 lg:sticky lg:top-8 dark:border-zinc-800">
      <h2 className="font-semibold">Cart ({count})</h2>
      {count === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Your cart is empty.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {cart.lines.map(({ product, quantity }) => (
            <li key={product.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">{product.name}</span>
              <select
                aria-label={`Quantity for ${product.name}`}
                value={quantity}
                onChange={(e) => dispatch({ type: "setQty", productId: product.id, quantity: Number(e.target.value) })}
                className="rounded border border-zinc-300 bg-transparent px-1 dark:border-zinc-700"
              >
                {Array.from({ length: MAX_QTY }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="w-20 text-right tabular-nums">{formatCents(product.priceCents * quantity)}</span>
              <button
                type="button"
                aria-label={`Remove ${product.name}`}
                onClick={() => dispatch({ type: "remove", productId: product.id })}
                className="text-zinc-400 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-between border-t border-zinc-200 pt-3 font-semibold dark:border-zinc-800">
        <span>Subtotal</span>
        <span className="tabular-nums">{formatCents(subtotalCents(cart))}</span>
      </div>
      {/* TODO(H3): link to /checkout once the donation card page exists. */}
      <button
        type="button"
        disabled
        className="mt-4 w-full rounded-md bg-zinc-900 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Checkout
      </button>
    </aside>
  );
}
