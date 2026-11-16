import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { Metadata } from "next";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";

export const metadata: Metadata = {
  title: "Gratis skabeloner til freelancere: timeseddel, faktura, tilbud",
  description:
    "Download gratis skabeloner til freelancere: timeseddel (Excel), månedlig timeregistrering, dansk faktura med moms, klippekort-aftale og tilbudsskabelon (Word). Ingen login.",
  alternates: { canonical: "/skabeloner" },
  openGraph: {
    title: "Gratis skabeloner til freelancere",
    description:
      "Timeseddel, timeregistrering, faktura, klippekort-aftale og tilbud. Download frit, ingen login.",
    url: "/skabeloner",
    type: "website",
    images: [
      {
        url: "/api/og?badge=Gratis%20downloads&title=Skabeloner%20til%20freelancere&subtitle=Timeseddel%2C%20faktura%2C%20klippekort-aftale%20og%20tilbud",
        width: 1200,
        height: 630,
      },
    ],
  },
};

const TEMPLATES: {
  file: string;
  format: "Excel" | "Word";
  title: string;
  description: string;
}[] = [
  {
    file: "/skabeloner/timeseddel-uge.xlsx",
    format: "Excel",
    title: "Timeseddel (uge)",
    description:
      "Klassisk ugentlig timeseddel: start, slut og pause pr. dag. Timerne beregnes automatisk.",
  },
  {
    file: "/skabeloner/timeregistrering-maaned.xlsx",
    format: "Excel",
    title: "Timeregistrering (måned)",
    description:
      "Månedsark med kunde, opgave, timer og timepris. Beløb og totaler beregnes automatisk.",
  },
  {
    file: "/skabeloner/faktura-skabelon.xlsx",
    format: "Excel",
    title: "Faktura med dansk moms",
    description:
      "Dansk faktura med de lovpligtige felter, fakturalinjer og automatisk 25% moms.",
  },
  {
    file: "/skabeloner/klippekort-aftale.docx",
    format: "Word",
    title: "Klippekort-aftale",
    description:
      "Aftaleskabelon til forudbetalte timepakker: timer, pris, gyldighed, trækning og udløbsvilkår.",
  },
  {
    file: "/skabeloner/tilbud-skabelon.docx",
    format: "Word",
    title: "Tilbudsskabelon",
    description:
      "Struktureret tilbud: opgave, leverancer, pris, forudsætninger, rettelsesrunder og accept.",
  },
];

export default function SkabelonerPage() {
  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Gratis skabeloner til freelancere",
    itemListElement: TEMPLATES.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.title,
    })),
  };

  return (
    <SEOPageLayout
      badge="Gratis downloads, ingen login"
      title="Skabeloner til freelancere"
      subtitle="Timeseddel, timeregistrering, faktura, klippekort-aftale og tilbud. Download, udfyld, brug. Helt gratis."
      jsonLd={itemListSchema}
      relatedLinks={[
        {
          href: "/vaerktoejer",
          title: "Alle gratis værktøjer",
          description: "Beregnere, timere og tests til freelancere.",
        },
        {
          href: "/timeseddel-skabelon",
          title: "Interaktiv timeseddel",
          description: "Udfyld timesedlen direkte i browseren.",
        },
        {
          href: "/faktura-skabelon",
          title: "Interaktiv faktura",
          description: "Byg fakturaen direkte i browseren.",
        },
      ]}
      ctaTitle="Træt af skabeloner?"
      ctaSubtitle="TimeTrack udfylder dem for dig: timerne registreres mens du arbejder, og fakturaen bygger sig selv."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((template) => (
              <a
                key={template.file}
                href={template.file}
                download
                className="group rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
              >
                {template.format === "Excel" ? (
                  <FileSpreadsheet className="mb-4 h-8 w-8 text-green-700" />
                ) : (
                  <FileText className="mb-4 h-8 w-8 text-brand-600" />
                )}
                <h2 className="mb-1 text-lg font-semibold text-slate-900 group-hover:text-brand-700">
                  {template.title}
                </h2>
                <p className="text-sm text-slate-600">{template.description}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                  <Download className="h-4 w-4" />
                  Download ({template.format})
                </span>
              </a>
            ))}
          </div>
          <ToolLeadCapture tool="skabeloner" />
        </div>
      </section>
    </SEOPageLayout>
  );
}
