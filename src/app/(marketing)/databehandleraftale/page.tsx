import type { Metadata } from "next";
import Link from "next/link";
import { SimpleMarkdown } from "@/components/enterprise/SimpleMarkdown";
import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import {
  DPA_MARKDOWN,
  DPA_VERSION,
  DPA_VERSION_DATE,
} from "@/lib/enterprise/dpa/content";
import { dpaBodyMarkdown } from "@/lib/enterprise/dpa/meta";
import { DpaPdfActions } from "./DpaPdfActions";

const TITLE = "Databehandleraftale";
const DESCRIPTION =
  "TimeTracks databehandleraftale efter GDPR artikel 28. Gælder for alle planer: parter, sikkerhed, backup, underdatabehandlere med land og overførselsgrundlag.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/databehandleraftale" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/databehandleraftale",
    type: "website",
    locale: "da_DK",
    siteName: "TimeTrack",
  },
};

// Teksten er den samme som i accepten og PDF'en (src/lib/enterprise/dpa/
// content.ts, genereret fra docs/DPA.md). Overskriften fjernes her, fordi
// heroen viser den.
const BODY = dpaBodyMarkdown(DPA_MARKDOWN);
const CONTACT_EMAIL = "timetrack@timetrack.dk";

export default function DatabehandleraftalePage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        align="left"
        title="Databehandleraftale"
        subtitle="Bruger du TimeTrack til oplysninger om andre, fx medarbejdere eller dine kunder, er TimeTrack din databehandler. Aftalen her gælder for alle planer."
      >
        <p className="mt-6 text-sm text-gray-500">
          Version {DPA_VERSION}, {DPA_VERSION_DATE}
        </p>
      </MarketingHero>

      <main className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <DpaPdfActions />

          <p className="mt-6 text-sm leading-relaxed text-gray-700">
            Ejere og administratorer kan acceptere aftalen elektronisk på alle
            planer under Indstillinger &gt; GDPR &amp; Databeskyttelse. Vil du
            hellere have en fysisk underskrevet kopi, så skriv til mig på{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              {CONTACT_EMAIL}
            </a>
            . Hvor dine data ligger, og hvem der behandler dem, står også på{" "}
            <Link
              href="/tillid"
              className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              Tillid og data
            </Link>
            .
          </p>

          <article className="mt-8 rounded-xl border border-gray-200 bg-white p-5 sm:p-8">
            <SimpleMarkdown markdown={BODY} lightOnly />
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
