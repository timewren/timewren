import { Check, Clock, FileText, Shield, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { AppScreenshot } from "@/components/marketing/AppScreenshot";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

export const metadata: Metadata = {
  title: "Timeregistrering: uden bøvl",
  description:
    "Timeregistrering til freelancere: track tid pr. kunde/projekt, få rapporter og eksportér til fakturering. Start gratis med TimeTrack.",
  openGraph: {
    title: "Timeregistrering: uden bøvl",
    description:
      "Timeregistrering til freelancere: track tid pr. kunde/projekt, få rapporter og eksportér til fakturering. Start gratis med TimeTrack.",
  },
  alternates: { canonical: "/timeregistrering" },
};

export default function TimeregistreringPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er forskellen på timeregistrering og tidsregistrering?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Mange bruger ordene som synonymer. Timeregistrering bruges ofte når fokus er faktura/fakturagrundlag, og tidsregistrering når fokus er dokumentation/overblik.",
        },
      },
      {
        "@type": "Question",
        name: "Skal jeg bruge en timer, eller kan jeg registrere manuelt?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Begge dele. Brug timer når du kan, og manuel registrering når du skal. Det vigtigste er konsistens.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan bliver det til en faktura?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Lav rapport pr. periode og brug eksporten som fakturagrundlag. Se siden Timeregistrering til faktura for workflow.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Er TimeTrack kun for WordPress-folk?",
      answer: (
        <p>
          Nej. TimeTrack er lavet til solo-freelancere generelt, men er især god
          hvis du arbejder meget i browseren.
        </p>
      ),
    },
    {
      question: "Kan jeg eksportere til Billy/Dinero?",
      answer: (
        <p>
          Ja. Du kan starte med CSV/rapport, og koble Billy/Dinero på når du
          vil.
        </p>
      ),
    },
    {
      question: "Er der binding?",
      answer: <p>Nej. Du kan opsige når som helst.</p>,
    },
    {
      question: "Hvad er forskellen på timeregistrering og tidsregistrering?",
      answer: (
        <p>
          Mange bruger ordene som synonymer. Vi bruger ofte timeregistrering når
          fokus er faktura/fakturagrundlag og tidsregistrering når fokus er
          dokumentation/overblik.
        </p>
      ),
    },
    {
      question: "Skal jeg bruge en timer, eller kan jeg registrere manuelt?",
      answer: (
        <p>
          Begge dele. Brug timer når du kan, og manuel registrering når du skal.
          Det vigtigste er at du er konsekvent.
        </p>
      ),
    },
    {
      question: "Hvordan bliver det til en faktura?",
      answer: (
        <p>
          Du laver rapport pr. periode og bruger eksporten som fakturagrundlag.
          Se:{" "}
          <Link className="underline" href="/timeregistrering-til-faktura">
            timeregistrering til faktura
          </Link>
          .
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Fra timer til specifikation og faktura.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation kunden forstår.",
    },
    {
      href: "/tidsregistrering",
      title: "Tidsregistrering",
      description: "Når fokus er dokumentation og ro.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Prepaid timer med saldo og historik.",
    },
    {
      href: "/billy",
      title: "Billy",
      description: "Eksport/flow der passer til Billy.",
    },
    {
      href: "/dinero",
      title: "Dinero",
      description: "Eksport/flow der passer til Dinero.",
    },
  ];

  return (
    <SEOPageLayout
      title="Timeregistrering: uden bøvl"
      subtitle="TimeTrack hjælper dig med at tracke timer pr. kunde og projekt, få overblik og lave et fakturagrundlag du kan stole på."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedSubtitle="Mere om timeregistrering, fakturagrundlag og prepaid/klippekort:"
    >
      {/* Value props */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Clock className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Timetracking der bliver brugt
              </h2>
              <p className="text-slate-600">
                Timer + manuelle entries. Det vigtigste er at du er konsekvent.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapporter & eksport
              </h2>
              <p className="text-slate-600">
                Uge- og månedsoverblik pr. kunde og CSV/rapport til fakturering.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Privatliv & kontrol
              </h2>
              <p className="text-slate-600">
                Du bestemmer tracking-niveauet og kan justere undervejs.
              </p>
            </div>
          </div>

          {/* Screenshot */}
          <div className="mt-14">
            <div className="mx-auto max-w-4xl">
              <AppScreenshot
                src="/screenshots/dashboard/desktop-time-tracking.png"
                alt="TimeTrack tidsregistrering: timer pr. kunde og projekt med overblik"
              />
            </div>
          </div>

          <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <h3 className="text-2xl font-bold text-slate-900">
                Typiske problemer vi løser
              </h3>
              <ul className="mt-6 space-y-4 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Timerne bliver skrevet ind "til sidst", og så mangler der
                    altid noget.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Fakturering bliver et gæt i stedet for en klar
                    specifikation.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>
                    Det er uklart hvad der er billable/non-billable og hvad der
                    allerede er faktureret.
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
              <div className="flex items-start gap-3">
                <Target className="mt-1 h-6 w-6 text-brand-600" />
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    Hurtigt tip
                  </h3>
                  <p className="mt-2 text-slate-600">
                    Start med 1–2 kunder, track en uge, og brug rapporten som
                    fakturagrundlag. Når vanen sidder, kan du udvide.
                  </p>
                  <p className="mt-4 text-sm text-slate-600">
                    Næste step:{" "}
                    <Link
                      className="underline"
                      href="/timeregistrering-til-faktura"
                    >
                      timeregistrering til faktura
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Opret en kunde og et projekt, track tid, og eksportér når du skal
              fakturere.
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
