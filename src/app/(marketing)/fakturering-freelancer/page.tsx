import { ArrowRight, FileText, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { AppScreenshot } from "@/components/marketing/AppScreenshot";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

export const metadata: Metadata = {
  title: "Fakturering for freelancere (med timetracking)",
  description:
    "Fakturering for freelancere: saml timer pr. kunde/periode, lav rapport og eksportér til faktura. Timetracking der gør fakturering lettere. Gratis at starte.",
  alternates: { canonical: "/fakturering-freelancer" },
};

export default function FaktureringFreelancerPage() {
  return (
    <SEOPageLayout
      title="Fakturering for freelancere (med timetracking)"
      subtitle="Fakturering bliver nem, når timetracking og dokumentation sidder. TimeTrack hjælper dig med at samle timer pr. kunde og eksportere når du skal fakturere."
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Target className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kunder &amp; projekter
              </h2>
              <p className="text-slate-600">
                Struktur der gør det let at fakturere rigtigt.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <TrendingUp className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Mindre tabt tid
              </h2>
              <p className="text-slate-600">
                Timetracking der fanger timerne løbende.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapport &amp; eksport
              </h2>
              <p className="text-slate-600">
                CSV/rapport til faktura og integration med Billy, Dinero og
                e-conomic.
              </p>
            </div>
          </div>

          {/* Screenshot */}
          <div className="mt-14">
            <div className="mx-auto max-w-4xl">
              <AppScreenshot
                src="/screenshots/dashboard/desktop-clients.png"
                alt="TimeTrack kundeoversigt: kunder, projekter og fakturagrundlag"
              />
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">Start simpelt</h3>
            <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
              <li>Track tid pr. kunde/projekt</li>
              <li>Se rapport pr. periode</li>
              <li>Eksportér når du skal fakturere</li>
            </ol>
            <p className="mt-6 text-sm text-slate-600">
              Se også:{" "}
              <Link className="underline" href="/timeregistrering-til-faktura">
                timeregistrering til faktura
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">Opret konto og test i en uge.</p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-8 py-4 font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg"
            >
              Se priser
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
