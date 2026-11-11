import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminPanel } from "@/components/AdminPanel";
import { modes } from "@/lib/api";
import { mockCauses } from "@/lib/mocks";

export const metadata: Metadata = { title: "Admin · Offset" };

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-4xl p-4 text-zinc-500 sm:p-8">Loading…</p>}>
      <Admin />
    </Suspense>
  );
}

// PAYOUT_MODE is read per request (like /checkout) so the SIMULATED badge always matches the API.
async function Admin() {
  await connection();
  const causes = mockCauses.map(({ id, name, impactNote }) => ({ id, name, impactNote }));
  // Outside production with no ADMIN_TOKEN set, the API accepts "dev-admin"; prefill it so the demo is one click.
  const devToken = process.env.NODE_ENV !== "production" && !process.env.ADMIN_TOKEN ? "dev-admin" : "";
  return <AdminPanel causes={causes} payoutMode={modes.payout()} devToken={devToken} />;
}
