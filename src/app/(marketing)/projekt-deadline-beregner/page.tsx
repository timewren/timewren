import { Calendar, Clock, Target } from "lucide-react";
import type { Metadata } from "next";
import { ProjectDeadlineCalculator } from "@/components/marketing/ProjectDeadlineCalculator";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

export const metadata: Metadata = {
  title: "Projekt deadline-beregner: beregn hvornår projektet er færdigt",
  description:
    "Gratis deadline-beregner. Indtast estimerede timer og timer pr. uge, og se hvornår dit projekt er færdigt. Med buffer for uforudsete opgaver.",
  alternates: { canonical: "/projekt-deadline-beregner" },
  openGraph: {
    title: "Projekt deadline-beregner | TimeTrack",
    description:
      "Beregn hvornår dit projekt er færdigt baseret på estimerede timer og din ugentlige kapacitet.",
    url: "/projekt-deadline-beregner",
    type: "website",
  },
};

export default function ProjektDeadlineBeregnerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvordan beregner jeg en realistisk projekt-deadline?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Estimér det totale antal timer projektet kræver, dividér med antal timer du kan arbejde pr. uge, og læg 15-20% buffer til for uforudsete opgaver. Deadline-beregneren gør dette automatisk.",
        },
      },
      {
        "@type": "Question",
        name: "Hvor stor buffer bør jeg lægge til?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "En buffer på 15-20% er standard for de fleste projekter. For komplekse eller ukendte projekter kan 25-30% være mere realistisk. Deadline-beregneren lader dig justere bufferen.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg bruge beregneren gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Deadline-beregneren er helt gratis og kræver ingen login. Du kan bruge den med det samme.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvordan beregner jeg en realistisk projekt-deadline?",
      answer: (
        <p>
          Estimér det totale antal timer projektet kræver, dividér med antal
          timer du kan arbejde pr. uge, og læg 15-20% buffer til for uforudsete
          opgaver. Denne beregner gør det automatisk.
        </p>
      ),
    },
    {
      question: "Hvor stor buffer bør jeg lægge til?",
      answer: (
        <p>
          En buffer på 15-20% er standard for de fleste projekter. For komplekse
          eller ukendte projekter kan 25-30% være mere realistisk.
        </p>
      ),
    },
    {
      question: "Kan jeg bruge beregneren gratis?",
      answer: (
        <p>
          Ja. Deadline-beregneren er helt gratis og kræver ingen login. Du kan
          bruge den med det samme.
        </p>
      ),
    },
    {
      question: "Tæller beregneren weekender med?",
      answer: (
        <p>
          Beregneren viser både kalenderuger og arbejdsdage (mandag-fredag), så
          du kan se forskellen. Timer pr. uge fordeles over 5 arbejdsdage.
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
      title="Projekt deadline-beregner"
      subtitle="Beregn hvornår dit projekt er færdigt. Indtast timer og kapacitet, og få en realistisk deadline med buffer."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Flere gratis værktøjer til projektplanlægning:"
      ctaTitle="Vil du tracke dine projekttimer automatisk?"
      ctaSubtitle="Med TimeTrack registrerer du timer pr. projekt, ser fremgang og får besked når du nærmer dig deadline. Gratis at starte."
    >
      {/* Interactive calculator */}
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="projekt-deadline-beregner">
            <ProjectDeadlineCalculator />
          </ToolUsageTracker>
          <ToolLeadCapture tool="projekt-deadline-beregner" />
        </div>
      </section>

      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Hold styr på dine projekter
            </h2>
            <p className="text-lg text-slate-600">
              TimeTrack giver dig deadlines, timer og overblik over alle dine
              projekter.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Target className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Deadlines pr. projekt
              </h3>
              <p className="text-slate-600">
                Sæt deadlines og se præcis hvor mange timer der er brugt og hvor
                mange der er tilbage.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Automatisk tidsregistrering
              </h3>
              <p className="text-slate-600">
                Start en timer med ét klik. Timer gemmes automatisk på det
                rigtige projekt og den rigtige kunde.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Calendar className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Kalender og rapporter
              </h3>
              <p className="text-slate-600">
                Se dine timer i en kalendervisning og lav rapporter pr. uge,
                måned eller projekt.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
