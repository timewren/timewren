import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchePage } from "@/components/marketing/BranchePage";
import { BRANCHER } from "@/lib/marketing/brancher";

export const metadata: Metadata = {
  title: "Timeregistrering for udviklere: fang support og småfixes",
  description:
    "Timeregistrering til freelanceudviklere: ét-kliks timer, tid pr. kunde/projekt, klippekort til support-aftaler og faktura direkte fra timerne. Gratis at starte.",
  alternates: { canonical: "/timeregistrering-udvikler" },
  openGraph: {
    title: "Timeregistrering for udviklere: fang support og småfixes",
    description:
      "Timeregistrering til freelanceudviklere: ét-kliks timer, tid pr. kunde/projekt, klippekort til support-aftaler og faktura direkte fra timerne. Gratis at starte.",
    url: "/timeregistrering-udvikler",
    type: "website",
  },
};

export default function TimeregistreringUdviklerPage() {
  const branche = BRANCHER.find((b) => b.slug === "udvikler");
  if (!branche) notFound();
  return <BranchePage branche={branche} />;
}
