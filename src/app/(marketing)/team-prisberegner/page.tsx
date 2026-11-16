import { Clock, FileText, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { TeamPrisBeregner } from "@/components/marketing/TeamPrisBeregner";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { FREE_MAX_SEATS } from "@/lib/billing/plan-gate";
import {
  BUSINESS_INCLUDED_SEATS,
  BUSINESS_MAX_SEATS,
  BUSINESS_SEAT_PRICE_MONTHLY,
  TEAM_INCLUDED_SEATS,
  TEAM_MAX_SEATS,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";

const TITLE = "Pris på tidsregistrering til teams: beregn jeres pris";
const DESCRIPTION = `Hvad koster tidsregistrering til jeres medarbejdere? Vælg antal brugere og se prisen pr. måned og pr. år. Team ${TEAM_SEAT_PRICE_MONTHLY} kr. og Virksomhed ${BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger/md. ekskl. moms.`;
const OG_IMAGE =
  "/api/og?badge=Gratis%20beregner&title=Team-prisberegner&subtitle=Hvad%20koster%20tidsregistrering%20til%20jeres%20team%3F";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/team-prisberegner" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/team-prisberegner",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: [OG_IMAGE] },
};

const FAQ = [
  {
    question: "Hvad koster tidsregistrering pr. medarbejder?",
    answer: `Team koster ${TEAM_SEAT_PRICE_MONTHLY} kr. pr. bruger/md. ekskl. moms (min. ${TEAM_INCLUDED_SEATS} brugere, op til ${TEAM_MAX_SEATS}). Virksomhed koster ${BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger/md. (min. ${BUSINESS_INCLUDED_SEATS} brugere, op til ${BUSINESS_MAX_SEATS}). Betaler I årligt, får I 2 måneder gratis.`,
  },
  {
    question: "Hvad er forskellen på Team og Virksomhed?",
    answer:
      "Team er til bureauer og mindre teams, der deler kunder, projekter, klippekort og fakturagrundlag. Virksomhed lægger ferie, fravær, flex-tid, check-in, godkendelser og SSO oveni, så I kan registrere arbejdstid efter arbejdstidsloven.",
  },
  {
    question: "Betaler vi for brugere, vi ikke bruger?",
    answer:
      "Nej. I betaler for de pladser, der er i brug, ud over planens minimum. Inviterer I en ny medarbejder, udvides abonnementet automatisk, og fjerner I en, falder prisen igen.",
  },
  {
    question: "Kan vi prøve det, før vi betaler?",
    answer: `Ja. I får 30 dage med alle funktioner uden betalingskort. Vælger I ikke en betalt plan, fortsætter I på Gratis med op til ${FREE_MAX_SEATS} brugere.`,
  },
];

export default function TeamPrisBeregnerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <SEOPageLayout
      badge="Gratis værktøj"
      title="Hvad koster tidsregistrering til jeres team?"
      subtitle="Vælg hvor mange I er, og se prisen med det samme. Ingen skjulte gebyrer, ingen binding."
      jsonLd={faqSchema}
      faqItems={FAQ.map((item) => ({
        question: item.question,
        answer: <p>{item.answer}</p>,
      }))}
      relatedLinks={[
        {
          href: "/teams-og-bureauer",
          title: "TimeTrack til teams og bureauer",
          description: "Fælles kunder, projekter og klippekort.",
        },
        {
          href: "/virksomheder",
          title: "TimeTrack til virksomheder",
          description: "Ferie, fravær, flex og godkendelser.",
        },
        {
          href: "/blog/tidsregistrering-lov-danmark",
          title: "Arbejdstidsloven forklaret",
          description: "Hvad kræver loven af jeres tidsregistrering?",
        },
      ]}
      ctaTitle="Kom i gang med hele teamet i dag"
      ctaSubtitle="30 dage med alle funktioner. Intet betalingskort."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <ToolUsageTracker tool="team-prisberegner">
            <TeamPrisBeregner />
          </ToolUsageTracker>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Hvad I får for prisen
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Tid på alle platforme
              </h3>
              <p className="text-slate-600">
                Web, mobilapp, browser-extension og desktop er med i alle
                planer. Medarbejderne starter timeren der, hvor de arbejder.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Fra timer til faktura
              </h3>
              <p className="text-slate-600">
                Fakturagrundlag pr. kunde og direkte overførsel til{" "}
                <Link className="underline" href="/billy">
                  Billy
                </Link>{" "}
                og{" "}
                <Link className="underline" href="/dinero">
                  Dinero
                </Link>
                , samt integration med{" "}
                <Link className="underline" href="/e-conomic">
                  e-conomic
                </Link>
                .
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <ShieldCheck className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Dansk, og databasen i EU
              </h3>
              <p className="text-slate-600">
                Database og backup ligger i EU, support er på dansk, og der er
                ingen binding, så I kan opsige når som helst.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
