import type { Metadata } from "next";
import { ImpactPage } from "@/components/ImpactPage";
import { mockCauses } from "@/lib/mocks";

export const metadata: Metadata = { title: "Impact · Offset" };

export default function Impact() {
  const causes = mockCauses.map(({ id, name, impactNote }) => ({ id, name, impactNote }));
  return <ImpactPage causes={causes} />;
}
