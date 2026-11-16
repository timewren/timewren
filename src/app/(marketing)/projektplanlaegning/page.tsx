import { CalendarDays, ListChecks, Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Projektplanlægning for freelancere",
  description:
    "Projektplanlægning for freelancere: planlæg projekter med deadlines, opgaver og timeregistrering. Simpelt overblik uden komplekse værktøjer. Prøv gratis.",
  alternates: { canonical: "/projektplanlaegning" },
};

export default function ProjektplanlaegningPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er projektplanlægning for freelancere?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Projektplanlægning for freelancere handler om at sætte deadlines, fordele opgaver og registrere tid, uden de tunge PM-tools.",
        },
      },
      {
        "@type": "Question",
        name: "Har TimeTrack Gantt-diagrammer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. TimeTrack fokuserer på simpel planlægning: opgaver med deadlines, kanban-board og timeregistrering. Det er alt de fleste freelancere har brug for.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg planlægge med recurring opgaver?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack har recurring templates der automatisk opretter opgaver dagligt, ugentligt eller månedligt. Perfekt til vedligeholdelse og retainers.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg se et projektoverblik?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Se alle projekter pr. kunde med status, budget, timer og deadlines samlet ét sted.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er projektplanlægning for freelancere?",
      answer: (
        <p>
          Projektplanlægning for freelancere handler om at sætte deadlines,
          fordele opgaver og registrere tid, uden de tunge PM-tools.
        </p>
      ),
    },
    {
      question: "Har TimeTrack Gantt-diagrammer?",
      answer: (
        <p>
          Nej. TimeTrack fokuserer på simpel planlægning: opgaver med deadlines,
          kanban-board og timeregistrering. Se også{" "}
          <Link className="underline" href="/projektstyring">
            projektstyring
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Kan jeg planlægge med recurring opgaver?",
      answer: (
        <p>
          Ja. TimeTrack har recurring templates der automatisk opretter opgaver
          dagligt, ugentligt eller månedligt. Perfekt til vedligeholdelse og
          retainers.
        </p>
      ),
    },
    {
      question: "Kan jeg se et projektoverblik?",
      answer: (
        <p>
          Ja. Se alle projekter pr. kunde med status, budget, timer og deadlines
          samlet ét sted.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/projektstyring",
      title: "Projektstyring",
      description: "Simpel projektstyring for freelancere.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Track timer pr. kunde og projekt.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Sælg prepaid timer til dine kunder.",
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
      title="Projektplanlægning for freelancere"
      subtitle="Planlæg og følg projekter med deadlines, opgaver og timer. Simpelt og overskueligt."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Projektplanlægning hænger sammen med styring og timeregistrering:"
      ctaTitle="Start din projektplanlægning"
      ctaSubtitle="Planlæg projekter med deadlines, opgaver og timer. Gratis at starte."
    >
      {/* Workflow steps */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Sådan planlægger du projekter
            </h2>
            <p className="text-lg text-slate-600">
              Tre trin fra ide til overblik, uden komplekse værktøjer
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-600">
                1
              </div>
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Opret projekt og opgaver
              </h3>
              <p className="text-slate-600">
                Tilknyt projektet til en kunde, tilføj opgaver med deadlines og
                prioriteter, og sæt et budget.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-600">
                2
              </div>
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Track tid på opgaver
              </h3>
              <p className="text-slate-600">
                Start en timer eller registrér tid manuelt. Timerne knyttes
                automatisk til projektet og kunden.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-600">
                3
              </div>
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Få overblik og fakturér
              </h3>
              <p className="text-slate-600">
                Se samlet tidsforbrug, budget-status og opgave-progress. Lav
                rapport og fakturér direkte.
              </p>
            </div>
          </div>

          {/* Features detail */}
          <div className="mt-14 grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-6">
              <CalendarDays className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Deadlines
              </h3>
              <p className="text-slate-600">
                Sæt deadlines på projekter og opgaver. Få advarsler når
                deadlines nærmer sig.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-6">
              <ListChecks className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Opgavestyring
              </h3>
              <p className="text-slate-600">
                Kanban-board med drag-and-drop. Statusser, prioriteter og
                tilknytning til projekter.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-6">
              <Timer className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Recurring opgaver
              </h3>
              <p className="text-slate-600">
                Automatisk oprettelse af gentagne opgaver: dagligt, ugentligt
                eller månedligt. Perfekt til retainers.
              </p>
            </div>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Prøv projektplanlægning
            </h3>
            <p className="mt-2 text-slate-600">
              Opret dit første projekt med opgaver og deadlines på under 5
              minutter.
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
