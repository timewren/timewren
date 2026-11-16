import { BarChart3, Brain, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PomodoroTimer } from "@/components/marketing/PomodoroTimer";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

export const metadata: Metadata = {
  title: "Pomodoro-timer: gratis pomodoro teknik timer",
  description:
    "Gratis pomodoro-timer med 25 min arbejde og 5 min pause. Justerbar varighed, visuel progress-ring, lydnotifikation og session-tæller.",
  alternates: { canonical: "/pomodoro-timer" },
  openGraph: {
    title: "Pomodoro-timer: gratis pomodoro teknik timer | TimeTrack",
    description:
      "Arbejd fokuseret med pomodoro-teknikken. 25 min arbejde, 5 min pause. Gratis og uden login.",
    url: "/pomodoro-timer",
    type: "website",
  },
};

export default function PomodoroTimerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er pomodoro-teknikken?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Pomodoro-teknikken er en tidsmanagement-metode hvor du arbejder i fokuserede intervaller (typisk 25 minutter) efterfulgt af korte pauser (5 minutter). Efter 4 sessioner tager du en længere pause (15-20 minutter).",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg ændre varigheden?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Du kan tilpasse varigheden af arbejdssessioner, korte pauser og lange pauser. Standardindstillingen er 25/5/15 minutter, men du kan justere efter behov.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg bruge pomodoro-timeren gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Pomodoro-timeren er helt gratis og kræver ingen login. Du kan bruge den med det samme.",
        },
      },
      {
        "@type": "Question",
        name: "Giver timeren lyd når tiden er udløbet?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Timeren afspiller en kort lydnotifikation når en session eller pause er slut, så du kan fokusere uden at holde øje med skærmen.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er pomodoro-teknikken?",
      answer: (
        <p>
          Pomodoro-teknikken er en tidsmanagement-metode hvor du arbejder i
          fokuserede intervaller (typisk 25 minutter) efterfulgt af korte pauser
          (5 minutter). Efter 4 sessioner tager du en længere pause (15-20
          minutter). Teknikken hjælper dig med at holde fokus og undgå
          udbrændthed.
        </p>
      ),
    },
    {
      question: "Kan jeg ændre varigheden?",
      answer: (
        <p>
          Ja. Klik på "Indstillinger" under timeren for at tilpasse varigheden
          af arbejdssessioner, korte pauser og lange pauser.
          Standardindstillingen er 25/5/15 minutter.
        </p>
      ),
    },
    {
      question: "Kan jeg bruge pomodoro-timeren gratis?",
      answer: (
        <p>
          Ja. Pomodoro-timeren er helt gratis og kræver ingen login. Du kan
          bruge den med det samme.
        </p>
      ),
    },
    {
      question: "Giver timeren lyd når tiden er udløbet?",
      answer: (
        <p>
          Ja. Timeren afspiller en kort lydnotifikation når en session eller
          pause er slut. Lyden kræver at din browser tillader autoplay af lyd.
        </p>
      ),
    },
    {
      question: "Hvad er forskellen på denne timer og TimeTrack?",
      answer: (
        <p>
          Denne pomodoro-timer er et gratis standalone-værktøj.{" "}
          <Link className="underline" href="/register">
            TimeTrack
          </Link>{" "}
          har en indbygget pomodoro-timer der gemmer dine sessioner pr. kunde og
          projekt, klar til fakturering.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/online-stopur",
      title: "Online stopur",
      description: "Gratis stopur til tidsregistrering.",
    },
    {
      href: "/nedtaelling-deadline",
      title: "Nedtælling til deadline",
      description: "Countdown timer til din deadline.",
    },
    {
      href: "/klient-timer-oversigt",
      title: "Timeoversigt pr. kunde",
      description: "Registrer timer pr. kunde gratis.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Professionel tidsregistrering med TimeTrack.",
    },
  ];

  return (
    <SEOPageLayout
      title="Pomodoro-timer"
      subtitle="Arbejd fokuseret med pomodoro-teknikken. 25 min arbejde, 5 min pause, med justerbare indstillinger og lydnotifikation."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Flere gratis værktøjer til produktivitet:"
      ctaTitle="Vil du gemme dine pomodoro-sessioner?"
      ctaSubtitle="Med TimeTrack registrerer du pomodoro-sessioner pr. kunde og projekt. Se hvad du bruger din tid på, klar til fakturering. Gratis at starte."
    >
      {/* Interactive pomodoro timer */}
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="pomodoro-timer">
            <PomodoroTimer />
          </ToolUsageTracker>
        </div>
      </section>

      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Fra pomodoro til faktura
            </h2>
            <p className="text-lg text-slate-600">
              TimeTrack har en indbygget pomodoro-timer der gemmer alt
              automatisk.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Brain className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Pomodoro pr. projekt
              </h3>
              <p className="text-slate-600">
                Start en pomodoro-session på et specifikt projekt. Timer gemmes
                automatisk og tæller med i dine rapporter.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <BarChart3 className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Statistik og mønstre
              </h3>
              <p className="text-slate-600">
                Se hvornår du er mest produktiv, hvilke projekter der kræver
                flest sessioner, og hvordan din fokus udvikler sig.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Fleksibel tidsregistrering
              </h3>
              <p className="text-slate-600">
                Vælg mellem pomodoro, stopur eller manuel indtastning. TimeTrack
                tilpasser sig din arbejdsstil.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
