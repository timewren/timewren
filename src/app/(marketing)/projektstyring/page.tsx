import { Clock, Columns3, FolderOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE, PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Simpel projektstyring for freelancere",
  description:
    "Projektstyring for freelancere: overblik over kunder, projekter og timer. Kanban-board, opgaver og deadlines, uden kompleksiteten. Prøv gratis.",
  alternates: { canonical: "/projektstyring" },
};

export default function ProjektstyringPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Er TimeTrack et projektstyringsværktøj?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "TimeTrack er ikke et tungt PM-tool som Jira eller Asana. Det er simpel projektstyring bygget til freelancere: overblik over kunder, projekter, opgaver og timer.",
        },
      },
      {
        "@type": "Question",
        name: "Har TimeTrack et kanban-board?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack har et kanban-board med drag-and-drop, statusser (backlog, todo, i gang, færdig), prioriteter og deadlines.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg se timer pr. projekt?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Alle timer er knyttet til et projekt, så du kan se præcis, hvor lang tid du har brugt, og hvad det er værd.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad koster projektstyring i TimeTrack?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `Kanban, opgaver og deadlines koster ikke ekstra. Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms.`,
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Er TimeTrack et projektstyringsværktøj?",
      answer: (
        <p>
          TimeTrack er ikke et tungt PM-tool som Jira eller Asana. Det er simpel
          projektstyring bygget til freelancere: overblik over kunder,
          projekter, opgaver og timer.
        </p>
      ),
    },
    {
      question: "Har TimeTrack et kanban-board?",
      answer: (
        <p>
          Ja. TimeTrack har et kanban-board med drag-and-drop, statusser
          (backlog, todo, i gang, færdig), prioriteter og deadlines.
        </p>
      ),
    },
    {
      question: "Kan jeg se timer pr. projekt?",
      answer: (
        <p>
          Ja. Alle timer er knyttet til et projekt, så du kan se præcis, hvor
          lang tid du har brugt, og hvad det er værd.
        </p>
      ),
    },
    {
      question: "Hvad koster projektstyring i TimeTrack?",
      answer: (
        <p>
          Kanban, opgaver og deadlines koster ikke ekstra. Selvstændig koster{" "}
          <Link className="underline" href="/pricing">
            {PLAN_PRICES.selvstaendig.price} ekskl. moms
          </Link>
          .
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/projektplanlaegning",
      title: "Projektplanlægning",
      description: "Planlæg projekter med deadlines og opgaver.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Registrér timer pr. kunde og projekt.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Sælg forudbetalte timer til dine kunder.",
    },
    {
      href: "/kundeportal",
      title: "Kundeportal",
      description: "Giv kunder overblik over projekter.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Simpel projektstyring for freelancere"
      subtitle="Overblik over kunder, projekter og timer, uden kompleksiteten fra store PM-tools."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Projektstyring hænger sammen med timeregistrering og planlægning:"
      ctaTitle="Prøv simpel projektstyring"
      ctaSubtitle="Overblik over kunder, projekter og timer. Gratis at starte."
    >
      {/* Features */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Columns3 className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kanban-board
              </h2>
              <p className="text-slate-600">
                Flyt opgaver mellem backlog, todo, i gang og færdig med
                drag-and-drop. Sæt prioritet og deadline på hver opgave.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FolderOpen className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Projekt-overblik
              </h2>
              <p className="text-slate-600">
                Se alle projekter pr. kunde med status, budget og
                tidsregistrering. Hurtigt overblik over hvad der kører og hvad
                der er lukket.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Timer pr. projekt
              </h2>
              <p className="text-slate-600">
                Alle timer er knyttet til et projekt. Se hvor lang tid du har
                brugt, hvad det er værd, og hvad der er faktureret.
              </p>
            </div>
          </div>

          {/* Why simple */}
          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Hvorfor simpel projektstyring?
            </h3>
            <p className="mt-2 text-slate-600">
              De fleste freelancere har ikke brug for Gantt-diagrammer, sprints
              og story points. De har brug for at vide: hvilke projekter kører,
              hvad er status, og hvor mange timer er brugt.
            </p>
            <p className="mt-4 text-slate-600">
              TimeTrack giver dig præcis det, i et simpelt projektstyringssystem
              der er designet til freelancere og små konsulentfirmaer.
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Kom i gang med projektstyring
            </h3>
            <p className="mt-2 text-slate-600">
              Opret dit første projekt, tilføj opgaver og start med at
              registrere tid.
            </p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
