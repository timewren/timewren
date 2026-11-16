import { Bell, Clock, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DeadlineCountdown } from "@/components/marketing/DeadlineCountdown";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

export const metadata: Metadata = {
  title: "Nedtælling til deadline: gratis countdown timer",
  description:
    "Gratis nedtælling til deadline. Indtast dato og projektnavn, og se dage, timer, minutter og sekunder til deadline. Med visuel urgency-indikator.",
  alternates: { canonical: "/nedtaelling-deadline" },
  openGraph: {
    title: "Nedtælling til deadline: gratis countdown timer | TimeTrack",
    description:
      "Se præcis hvor lang tid der er til din deadline. Dage, timer, minutter og sekunder med farvet urgency-indikator.",
    url: "/nedtaelling-deadline",
    type: "website",
  },
};

export default function NedtaellingDeadlinePage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvordan virker nedtællingen?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Indtast din deadline-dato og tidspunkt, og nedtællingen viser præcist antal dage, timer, minutter og sekunder til deadline. Farven skifter fra grøn til rød jo tættere du kommer.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg bruge nedtællingen gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Nedtællingen er helt gratis og kræver ingen login. Du kan bruge den med det samme.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad betyder farverne?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Grøn = god tid (mere end 7 dage). Gul = under en uge. Orange = under 3 dage. Rød = under 1 dag. Farverne hjælper dig med at vurdere hvor presserende deadline er.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvordan virker nedtællingen?",
      answer: (
        <p>
          Indtast din deadline-dato og tidspunkt, og nedtællingen viser præcist
          antal dage, timer, minutter og sekunder til deadline. Farven skifter
          fra grøn til rød jo tættere du kommer.
        </p>
      ),
    },
    {
      question: "Kan jeg bruge nedtællingen gratis?",
      answer: (
        <p>
          Ja. Nedtællingen er helt gratis og kræver ingen login. Du kan bruge
          den med det samme.
        </p>
      ),
    },
    {
      question: "Hvad betyder farverne?",
      answer: (
        <p>
          Grøn = god tid (mere end 7 dage). Gul = under en uge. Orange = under 3
          dage. Rød = under 1 dag. Farverne hjælper dig med at vurdere hvor
          presserende deadline er.
        </p>
      ),
    },
    {
      question: "Kan jeg bruge den til flere projekter?",
      answer: (
        <p>
          Du kan ændre projektnavn og deadline når som helst. Vil du tracke
          flere deadlines samtidig? Opret en gratis{" "}
          <Link className="underline" href="/register">
            TimeTrack-konto
          </Link>{" "}
          og hold styr på alle dine projekter.
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
      href: "/projekt-deadline-beregner",
      title: "Deadline-beregner",
      description: "Beregn hvornår dit projekt er færdigt.",
    },
    {
      href: "/pomodoro-timer",
      title: "Pomodoro-timer",
      description: "Arbejd fokuseret med pomodoro-teknikken.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Professionel tidsregistrering med TimeTrack.",
    },
  ];

  return (
    <SEOPageLayout
      title="Nedtælling til deadline"
      subtitle="Se præcis hvor lang tid der er til din deadline. Med visuel urgency-indikator der skifter farve."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Flere gratis værktøjer til tidsregistrering:"
      ctaTitle="Vil du holde styr på alle dine deadlines?"
      ctaSubtitle="Med TimeTrack ser du alle projekter, deadlines og timer ét sted. Du får besked når en deadline nærmer sig. Gratis at starte."
    >
      {/* Interactive countdown */}
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="nedtaelling-deadline">
            <DeadlineCountdown />
          </ToolUsageTracker>
        </div>
      </section>

      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Mere end en nedtælling
            </h2>
            <p className="text-lg text-slate-600">
              TimeTrack hjælper dig med at nå dine deadlines og ikke bare tælle
              ned til dem.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Target className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Projekt-deadlines
              </h3>
              <p className="text-slate-600">
                Sæt deadlines på hvert projekt og se automatisk hvor mange timer
                du har brugt vs. hvad der er estimeret.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Bell className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Notifikationer
              </h3>
              <p className="text-slate-600">
                Få besked når en deadline nærmer sig, eller når du har brugt
                mere tid end estimeret på et projekt.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Automatisk tidsregistrering
              </h3>
              <p className="text-slate-600">
                Start en timer med ét klik. Timer gemmes automatisk på det
                rigtige projekt.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
