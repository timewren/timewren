import { Check, FileText, Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timeseddel skabelon (hvad den skal indeholde)",
  description:
    "Timeseddel skabelon: hvad den skal indeholde (kunde, projekt, periode, timer, sum). Alternativet til Excel er at tracke tid og generere rapport pr. periode. Gratis at starte.",
  alternates: { canonical: "/timeseddel-skabelon" },
};

export default function TimeseddelSkabelonPage() {
  const relatedLinks = [
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Få timerne ind.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Fra timer til faktura.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Dokumentation pr. periode.",
    },
    {
      href: "/timer-til-faktura",
      title: "Timer til faktura",
      description: "Workflow-siden.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
    {
      href: "/features",
      title: "Features",
      description: "Overblik over systemet.",
    },
  ];

  return (
    <SEOPageLayout
      title="Timeseddel skabelon (hvad den skal indeholde)"
      subtitle="Mange leder efter en timeseddel-skabelon i Excel. Men hvis du kan registrere tid pr. kunde/projekt og lave en rapport pr. periode, har du i praksis en timeseddel uden manuelt arbejde."
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede sider"
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Indhold
              </h2>
              <p className="text-slate-600">
                Kunde, projekt, dato/periode, timer og evt. beskrivelse.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Shield className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Tydelighed
              </h2>
              <p className="text-slate-600">
                Specifikation der gør fakturaen let at forstå.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Check className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rutine
              </h2>
              <p className="text-slate-600">
                Ugentligt/månedligt rapport til faktura.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Hvad skal en timeseddel-skabelon have?
            </h2>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Kunde + projekt</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Dato/periode</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Timer + evt. beskrivelse</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>Sum pr. periode (og evt. beløb ud fra timepris)</span>
              </li>
            </ul>

            <p className="mt-6 text-sm text-slate-600">
              Se også:{" "}
              <Link className="underline" href="/timeseddel">
                timeseddel
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Vil du slippe for skabelonen?
            </h3>
            <p className="mt-2 text-slate-600">
              Track tid løbende, lav rapport pr. periode og brug den direkte til
              faktura.
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
