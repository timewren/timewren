import { Calculator, PiggyBank, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { FreelanceBudget } from "@/components/marketing/FreelanceBudget";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Freelance budget: gratis budgetplanlægger",
  description:
    "Gratis freelance budgetplanlægger. Beregn indkomst, udgifter, overskud og skat. Få overblik over din freelance-økonomi med det samme.",
  alternates: { canonical: "/freelance-budget" },
  openGraph: {
    title: "Freelance budget: gratis budgetplanlægger | TimeTrack",
    description:
      "Beregn indkomst, udgifter, overskud og skat som freelancer. Gratis og uden login.",
    url: "/freelance-budget",
    type: "website",
  },
};

export default function FreelanceBudgetPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er et freelance budget?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Et freelance budget er en oversigt over dine indkomster og udgifter som selvstændig. Det hjælper dig med at forstå hvad du tjener, hvad du bruger, og hvad der er tilbage efter skat.",
        },
      },
      {
        "@type": "Question",
        name: "Hvor meget skat betaler en freelancer i Danmark?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Som tommelfingerregel bør du sætte ca. 40% af dit overskud til side til skat (inkl. AM-bidrag og bundskat). Det præcise beløb afhænger af dine fradrag og indkomst. Brug en revisor til den endelige beregning.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg bruge budgetberegneren gratis?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. Budgetberegneren er helt gratis og kræver ingen login. Du kan eksportere dit budget som CSV.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er typiske faste udgifter for en freelancer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Typiske faste udgifter inkluderer: kontor/husleje, erhvervsforsikring, softwareabonnementer, telefon og internet, fagforening og bogføring/regnskab.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er et freelance budget?",
      answer: (
        <p>
          Et freelance budget er en oversigt over dine indkomster og udgifter
          som selvstændig. Det hjælper dig med at forstå hvad du tjener, hvad du
          bruger, og hvad der er tilbage efter skat.
        </p>
      ),
    },
    {
      question: "Hvor meget skat betaler en freelancer i Danmark?",
      answer: (
        <p>
          Som tommelfingerregel bør du sætte ca. 40% af dit overskud til side
          til skat (inkl. AM-bidrag og bundskat). Det præcise beløb afhænger af
          dine fradrag og indkomst. Brug en revisor til den endelige beregning.
        </p>
      ),
    },
    {
      question: "Kan jeg bruge budgetberegneren gratis?",
      answer: (
        <p>
          Ja. Budgetberegneren er helt gratis og kræver ingen login. Du kan
          eksportere dit budget som CSV.
        </p>
      ),
    },
    {
      question: "Hvad er typiske faste udgifter for en freelancer?",
      answer: (
        <p>
          Typiske faste udgifter inkluderer: kontor/husleje, erhvervsforsikring,
          softwareabonnementer, telefon og internet, fagforening og
          bogføring/regnskab.
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
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Track timer pr. kunde og projekt.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Freelance budget"
      subtitle="Beregn din økonomi som freelancer. Indkomst, udgifter, skat og opsparing: få overblik med det samme."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Flere gratis værktøjer til freelancere:"
      ctaTitle="Vil du have styr på hele din freelance-forretning?"
      ctaSubtitle="Med TimeTrack får du timeregistrering, klippekort, fakturering og rapporter samlet ét sted. Gratis at starte."
    >
      {/* Interactive budget planner */}
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="freelance-budget">
            <FreelanceBudget />
          </ToolUsageTracker>
          <ToolLeadCapture tool="freelance-budget" />
        </div>
      </section>

      {/* USP cards */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">
              Fra budget til faktura
            </h2>
            <p className="text-lg text-slate-600">
              TimeTrack hjælper dig med hele den økonomiske side af
              freelancelivet.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Calculator className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Track dine timer
              </h3>
              <p className="text-slate-600">
                Registrer timer pr. kunde og projekt. Se præcis hvad du bruger
                din tid på og hvad det er værd.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <TrendingUp className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Rapporter og overblik
              </h3>
              <p className="text-slate-600">
                Lav rapporter pr. uge, måned eller kvartal. Se hvem dine bedste
                kunder er og hvor din tid går.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <PiggyBank className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Klippekort og fakturering
              </h3>
              <p className="text-slate-600">
                Sælg forudbetalte timepakker til dine kunder og fakturér
                automatisk baseret på registrerede timer.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
