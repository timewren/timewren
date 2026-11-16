import type { Metadata } from "next";
import { FreelanceHealthCheck } from "@/components/marketing/FreelanceHealthCheck";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

function parseScore(score?: string): number | undefined {
  const parsed = Number(score);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : undefined;
}

// Dynamisk metadata: et delt resultat-link (?score=NN) får et OG-billede
// med selve scoren — så delingen i feedet viser "NN af 100", ikke et
// generisk banner. Det er dét der gør resultatet værd at dele.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ score?: string }>;
}): Promise<Metadata> {
  const sharedScore = parseScore((await searchParams).score);
  const ogImage =
    sharedScore !== undefined
      ? `/api/og?badge=${encodeURIComponent("Freelance Health Check")}&score=${sharedScore}&title=${encodeURIComponent("Hvad scorer du?")}&subtitle=${encodeURIComponent("8 spørgsmål, 2 minutter: test din freelance-forretning")}`
      : `/api/og?badge=${encodeURIComponent("Gratis test: 2 minutter")}&title=${encodeURIComponent("Freelance Health Check")}&subtitle=${encodeURIComponent("Få en score 0-100 på din freelance-forretning")}`;

  return {
    title: "Freelance Health Check: hvor sund er din forretning?",
    description:
      "Gratis test: 8 spørgsmål, 2 minutter. Få en score fra 0-100 på din freelance-forretning: tidsregistrering, fakturering, timepris og likviditet, plus dine hurtigste gevinster.",
    alternates: { canonical: "/freelance-health-check" },
    openGraph: {
      title: "Freelance Health Check: hvor sund er din forretning?",
      description:
        "8 spørgsmål, 2 minutter: få en score 0-100 på din freelance-forretning og dine hurtigste gevinster.",
      url: "/freelance-health-check",
      type: "website",
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: [ogImage] },
  };
}

export default async function FreelanceHealthCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ score?: string }>;
}) {
  const sharedScore = parseScore((await searchParams).score);

  const quizSchema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Freelance Health Check",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "DKK" },
    description:
      "Gratis test af din freelance-forretning: 8 spørgsmål, score 0-100 og personlige anbefalinger.",
  };

  return (
    <SEOPageLayout
      badge="Gratis test: 2 minutter, ingen login"
      title="Freelance Health Check"
      subtitle="8 spørgsmål om tid, penge og aftaler. Få din score fra 0-100, og se præcis hvor din forretning lækker penge."
      jsonLd={quizSchema}
      relatedLinks={[
        {
          href: "/vaerktoejer",
          title: "Alle gratis værktøjer",
          description: "Beregnere, skabeloner og timere til freelancere.",
        },
        {
          href: "/ufaktureret-tid-beregner",
          title: "Ufaktureret tid-beregner",
          description: "Hvad koster glemte timer dig om året?",
        },
        {
          href: "/klippekort-prisberegner",
          title: "Klippekort-prisberegner",
          description: "Prissæt din timepakke rigtigt.",
        },
      ]}
      ctaTitle="Klar til at hæve din score?"
      ctaSubtitle="TimeTrack lukker de typiske lækager: tid registreres mens du arbejder, klippekort holder saldoen, og fakturaen bygger sig selv."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <ToolUsageTracker tool="freelance-health-check">
            <FreelanceHealthCheck sharedScore={sharedScore} />
          </ToolUsageTracker>
          <ToolLeadCapture tool="freelance-health-check" />
        </div>
      </section>
    </SEOPageLayout>
  );
}
