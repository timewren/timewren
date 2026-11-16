import { Check, FileText, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timeregistrering til faktura",
  description:
    "Gør timeregistrering til et tydeligt fakturagrundlag: track tid pr. kunde/projekt, lav rapport pr. periode og eksportér til faktura. Gratis at starte.",
  alternates: { canonical: "/timeregistrering-til-faktura" },
};

export default function TimeregistreringTilFakturaPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er et fakturagrundlag?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Et overblik pr. periode der viser timer pr. kunde/projekt (og evt. beløb), så fakturaen er tydelig.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad er den bedste minimale rutine?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Track tid pr. kunde/projekt, lav rapport ugentligt/månedligt og eksportér til faktura.",
        },
      },
      {
        "@type": "Question",
        name: "Skal jeg have Billy/Dinero for at fakturere?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nej. Du kan starte med CSV/rapport og koble regnskab på senere.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er et fakturagrundlag?",
      answer: (
        <p>
          Et overblik (typisk pr. periode) der viser timer pr. kunde/projekt og
          evt. beløb, så fakturaen er tydelig.
        </p>
      ),
    },
    {
      question: 'Hvad er den bedste "minimale" rutine?',
      answer: (
        <p>
          Track tid pr. kunde/projekt &rarr; lav rapport ugentligt/månedligt
          &rarr; eksportér.
        </p>
      ),
    },
    {
      question: "Skal jeg have Billy/Dinero for at fakturere?",
      answer: (
        <p>
          Nej. Du kan starte med CSV/rapport og koble regnskab på senere. Se:{" "}
          <Link className="underline" href="/billy">
            Billy
          </Link>{" "}
          /{" "}
          <Link className="underline" href="/dinero">
            Dinero
          </Link>
          .
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation pr. kunde og periode.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Grundlaget: konsekvent tracking.",
    },
    {
      href: "/tidsregistrering",
      title: "Tidsregistrering",
      description: "Når fokus er ro og dokumentation.",
    },
    {
      href: "/billy",
      title: "Billy",
      description: "Eksport/flow til Billy.",
    },
    {
      href: "/dinero",
      title: "Dinero",
      description: "Eksport/flow til Dinero.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Timeregistrering til faktura"
      subtitle="Få et fakturagrundlag der er tydeligt for kunden og nemt for dig. Registrér tid pr. kunde/projekt og eksportér når du skal fakturere."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="Flere sider med samme intent (timeregistrering, fakturering og regnskab):"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                Fra tid &rarr; specifikation &rarr; faktura
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Når timeregistrering er struktureret, bliver fakturering en
                rutine i stedet for en mental opgave.
              </p>

              <ul className="mt-6 space-y-4 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Timer pr. kunde og projekt</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Beløb beregnet ud fra timepris</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Rapport/CSV til fakturering</span>
                </li>
              </ul>

              <p className="mt-6 text-sm text-slate-600">
                Har du Billy? Se også:{" "}
                <Link className="underline" href="/billy">
                  Billy
                </Link>{" "}
                /{" "}
                <Link className="underline" href="/dinero">
                  Dinero
                </Link>
                .
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
              <div className="flex items-start gap-3">
                <FileText className="mt-1 h-6 w-6 text-brand-600" />
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    Praktisk workflow (5 minutter)
                  </h3>
                  <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
                    <li>Vælg kunde/projekt</li>
                    <li>Track tid (timer eller manuelt)</li>
                    <li>Gå til rapport pr. periode</li>
                    <li>Eksportér (CSV/rapport)</li>
                    <li>Send faktura med en klar specifikation</li>
                  </ol>
                </div>
              </div>

              <div className="mt-8 rounded-2xl bg-white p-6">
                <div className="flex items-start gap-3">
                  <TrendingUp className="mt-1 h-6 w-6 text-brand-600" />
                  <div>
                    <div className="font-semibold text-slate-900">Resultat</div>
                    <p className="mt-1 text-slate-600">
                      Færre &ldquo;hvor kom det beløb fra?&rdquo;-spørgsmål og
                      mindre tabt tid.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <QuickSignupForm variant="hero" />
                <p className="mt-4 text-sm text-slate-500">
                  Eller{" "}
                  <Link className="underline" href="/login">
                    log ind
                  </Link>{" "}
                  hvis du allerede har en konto.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <div className="flex items-start gap-3">
              <Target className="mt-1 h-6 w-6 text-brand-600" />
              <div>
                <h3 className="text-2xl font-bold text-slate-900">
                  Næste step
                </h3>
                <p className="mt-2 text-slate-600">
                  Hvis du vil have en ekstra SEO-side med mere
                  &ldquo;fakturering&rdquo;-intent, så se også{" "}
                  <Link className="underline" href="/faktura-ud-fra-timer">
                    faktura ud fra timer
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
