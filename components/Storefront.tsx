"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CatalogResponse, type Product } from "@/contracts";
import { formatCents, itemCount, MAX_QTY, subtotalCents } from "@/lib/cart";
import { useCart } from "./CartProvider";
import { LoadError } from "./LoadError";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; products: Product[] };

export function Storefront() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

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
  }, [attempt]);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 p-4 pb-24 sm:p-8 sm:pb-24 lg:grid-cols-[1fr_320px] lg:pb-8">
      <section>
        <h1 className="text-2xl font-semibold">Offset Store</h1>
        <p className="mt-1 text-sm text-zinc-500">Add items, then check out with an optional matched donation.</p>
        <div className="mt-6">
          {load.status === "loading" && <p className="text-zinc-500">Loading products…</p>}
          {load.status === "error" && (
            <LoadError
              message="Couldn't load products."
              detail={load.message}
              onRetry={() => {
                setLoad({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
            />
          )}
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
      <MobileCartBar />
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
    <aside id="cart" className="h-fit scroll-mt-4 rounded-lg border border-zinc-200 p-4 lg:sticky lg:top-8 dark:border-zinc-800">
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
      {count === 0 ? (
        <span className="mt-4 block w-full rounded-md bg-zinc-900 py-2 text-center text-sm text-white opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
          Checkout
        </span>
      ) : (
        <Link
          href="/checkout"
          className="mt-4 block w-full rounded-md bg-zinc-900 py-2 text-center text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Checkout
        </Link>
      )}
    </aside>
  );
}

/** Phones: the cart sits below all the products, so keep a summary and Checkout in reach. */
function MobileCartBar() {
  const { cart } = useCart();
  const count = itemCount(cart);
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <a href="#cart" className="flex-1 text-sm">
          <span className="font-semibold">
            {count} {count === 1 ? "item" : "items"}
          </span>{" "}
          <span className="tabular-nums text-zinc-600 dark:text-zinc-400">· {formatCents(subtotalCents(cart))}</span>
          <span className="block text-xs text-zinc-500 underline">View cart</span>
        </a>
        <Link
          href="/checkout"
          aria-label={`Checkout (${count} ${count === 1 ? "item" : "items"})`}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Checkout
        </Link>
      </div>
    </div>
  );
}
