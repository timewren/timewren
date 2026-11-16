import { Check, Clock, FileText, Shield, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

export const metadata: Metadata = {
  title: "Timeregistrering for freelancere",
  description:
    "Timeregistrering for freelancere: track tid pr. kunde/projekt, få rapporter/eksport og lav et fakturagrundlag du kan stole på. Gratis at starte.",
  alternates: { canonical: "/timeregistrering-freelancer" },
};

export default function TimeRegistrationFreelancerPage() {
  return (
    <SEOPageLayout
      title="Timeregistrering for freelancere"
      subtitle="TimeTrack gør det nemt at registrere tid pr. kunde og projekt og få et fakturagrundlag, du kan stole på."
    >
      {/* Problem / solution */}
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                Hvis du glemmer tracking, betaler du prisen
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                De fleste freelancere taber timer fordi tracking sker &quot;til
                sidst&quot;. TimeTrack er bygget til at gøre det let at være
                konsekvent.
              </p>

              <ul className="mt-6 space-y-4 text-slate-700">
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Overblik pr. kunde/projekt/periode</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Rapporter og eksport til fakturering</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                  <span>Timer + manuel tidsregistrering</span>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8 shadow-sm">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="rounded-2xl bg-white p-6">
                  <Clock className="mb-3 h-7 w-7 text-brand-600" />
                  <div className="font-semibold text-slate-900">
                    Mindre friktion
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    Start/stop eller registrér efterfølgende.
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-6">
                  <FileText className="mb-3 h-7 w-7 text-brand-600" />
                  <div className="font-semibold text-slate-900">
                    Fakturagrundlag
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    Timer + beløb + specifikation.
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-6">
                  <Target className="mb-3 h-7 w-7 text-brand-600" />
                  <div className="font-semibold text-slate-900">Kundefokus</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Dokumentér arbejdet klart.
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-6">
                  <Shield className="mb-3 h-7 w-7 text-brand-600" />
                  <div className="font-semibold text-slate-900">Kontrol</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Privatliv som standard.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Start med 1–2 kunder, track en uge, og brug rapporten som dit
              fakturagrundlag.
            </p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Har du spørgsmål? Se{" "}
              <Link className="underline" href="/contact">
                kontakt
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
