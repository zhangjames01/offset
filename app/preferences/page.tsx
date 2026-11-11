import type { Metadata } from "next";
import { PreferencesEditor } from "@/components/PreferencesEditor";
import { mockCauses } from "@/lib/mocks";

export const metadata: Metadata = { title: "Preferences · Offset" };

export default function PreferencesPage() {
  // Cause names are committed data (mocks/causes.json), so read them here instead of shipping all mocks to the client.
  const causes = mockCauses.map(({ id, name }) => ({ id, name }));
  return <PreferencesEditor causes={causes} />;
}
