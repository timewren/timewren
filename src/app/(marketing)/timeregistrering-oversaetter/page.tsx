import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchePage } from "@/components/marketing/BranchePage";
import { BRANCHER } from "@/lib/marketing/brancher";

export const metadata: Metadata = {
  title: "Timeregistrering for oversættere: kend timeprisen bag ordprisen",
  description:
    "Timeregistrering til freelanceoversættere: track tid pr. opgave, regn din reelle timepris bag ordprisen ud, og fakturér også revisionerne. Gratis at starte.",
  alternates: { canonical: "/timeregistrering-oversaetter" },
  openGraph: {
    title: "Timeregistrering for oversættere: kend timeprisen bag ordprisen",
    description:
      "Timeregistrering til freelanceoversættere: track tid pr. opgave, regn din reelle timepris bag ordprisen ud, og fakturér også revisionerne. Gratis at starte.",
    url: "/timeregistrering-oversaetter",
    type: "website",
  },
};

export default function TimeregistreringOversaetterPage() {
  const branche = BRANCHER.find((b) => b.slug === "oversaetter");
  if (!branche) notFound();
  return <BranchePage branche={branche} />;
}
