import { AlertCircle, Calculator, CreditCard } from "lucide-react";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import type { Branche } from "@/lib/marketing/brancher";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";
import { SEOPageLayout } from "./SEOPageLayout";

/**
 * Delt skabelon for branchesiderne (/timeregistrering-<branche>).
 * Alt brancheunikt indhold (intro, pains, benchmark, FAQ) kommer fra
 * datasættet i src/lib/marketing/brancher.ts.
 */
export function BranchePage({ branche }: { branche: Branche }) {
  const [minPris, maxPris] = branche.timeprisInterval;

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: branche.faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <SEOPageLayout
      badge={`Til ${branche.flertal}`}
      title={`Timeregistrering for ${branche.flertal}`}
      subtitle={branche.intro}
      jsonLd={faqSchema}
      faqItems={branche.faq.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedLinks={[
        {
          href: "/timepris-beregner",
          title: "Timepris-beregner",
          description: `Find din rigtige timepris som ${branche.ental}.`,
        },
        {
          href: "/klippekort-prisberegner",
          title: "Klippekort-prisberegner",
          description: "Prissæt forudbetalte timepakker til faste kunder.",
        },
        {
          href: "/ufaktureret-tid-beregner",
          title: "Ufaktureret tid-beregner",
          description: "Hvad koster glemte timer dig om året?",
        },
      ]}
      ctaTitle={`Prøv TimeTrack som ${branche.ental}`}
      ctaSubtitle="Gratis at starte. Registrér tid pr. kunde og fakturér uden at gætte."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Dér taber {branche.flertal} timerne
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {branche.pains.map((pain) => (
              <div
                key={pain.title}
                className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm"
              >
                <AlertCircle className="mb-4 h-8 w-8 text-brand-600" />
                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                  {pain.title}
                </h3>
                <p className="text-slate-600">{pain.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid items-center gap-10 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
              <div className="flex items-center gap-3">
                <Calculator className="h-8 w-8 text-brand-600" />
                <h2 className="text-2xl font-bold text-slate-900">
                  Timepris for {branche.flertal}
                </h2>
              </div>
              <p className="mt-4 text-slate-700">
                Danske {branche.flertal} ligger typisk i intervallet{" "}
                <strong>
                  {minPris.toLocaleString("da-DK")}&ndash;
                  {maxPris.toLocaleString("da-DK")} kr/time ekskl. moms
                </strong>{" "}
                afhængigt af speciale og erfaring. Det afgørende er dog din{" "}
                <em>effektive</em> timepris: det du reelt får, når al
                ufaktureret tid regnes med.
              </p>
              <Link
                href="/timepris-beregner"
                className="mt-4 inline-block font-semibold text-brand-600 hover:text-brand-700"
              >
                Beregn din timepris →
              </Link>
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
                <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <p className="text-sm text-slate-700">
                  <strong>Tip:</strong> Faste kunder med løbende behov? Sælg et{" "}
                  <Link className="underline" href="/klippekort">
                    klippekort
                  </Link>{" "}
                  med forudbetalte timer og automatisk saldo.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-semibold text-slate-900">
                Kom i gang på 2 minutter
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Gratis at starte, intet betalingskort. Selvstændig koster{" "}
                {PLAN_PRICES.selvstaendig.price} ekskl. moms, når du får brug
                for mere.
              </p>
              <div className="mt-6">
                <QuickSignupForm variant="hero" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
