// Placeholder home page. Hua replaces this with the storefront in H2.
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Offset</h1>
      <p className="mt-2 text-zinc-600">
        Purchase-linked giving at checkout. The storefront goes here (H2). All API routes under{" "}
        <code>/api</code> run in mock mode by default. Try <a className="underline" href="/api/catalog">/api/catalog</a>.
      </p>
    </main>
  );
}
