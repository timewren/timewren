import { Check, FileText, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

export const metadata: Metadata = {
  title: "CRM til freelancere? Kunder, projekter og timer",
  description:
    "Leder du efter et CRM til freelancere? TimeTrack er ikke et fuldt CRM, men holder styr på kunder, projekter og timer, med rapporter og eksport til faktura. Start gratis.",
  alternates: { canonical: "/crm-freelancer" },
};

export default function CrmFreelancerPage() {
  return (
    <SEOPageLayout
      title="Kunder, projekter og timer for freelancere"
      subtitle="TimeTrack er ikke et fuldt CRM, men holder styr på kunder, projekter og timer. Det er bygget til det, du faktisk fakturerer på: tid, opgaver, dokumentation og rapporter pr. kunde."
    >
      <section className="border-t bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Target className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Kundefokus
              </h2>
              <p className="text-slate-600">
                Kunder, projekter og opgaver: den struktur, du har brug for.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <TrendingUp className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Tidsregistrering
              </h2>
              <p className="text-slate-600">
                Timer + overblik pr. kunde, så du ikke taber indtjening.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <FileText className="mb-4 h-8 w-8 text-brand-600" />
              <h2 className="mb-2 text-xl font-semibold text-slate-900">
                Rapport & fakturagrundlag
              </h2>
              <p className="text-slate-600">
                Dokumentation og eksport når du skal fakturere.
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">
              Hvis du vil have det helt enkelt
            </h3>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  Start med{" "}
                  <Link className="underline" href="/timeregistrering">
                    timeregistrering
                  </Link>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  Brug{" "}
                  <Link
                    className="underline"
                    href="/timeregistrering-til-faktura"
                  >
                    timeregistrering til faktura
                  </Link>{" "}
                  når du fakturerer
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-green-600" />
                <span>
                  Tilføj integrationer senere (fx{" "}
                  <Link className="underline" href="/billy">
                    Billy
                  </Link>{" "}
                  /{" "}
                  <Link className="underline" href="/dinero">
                    Dinero
                  </Link>
                  )
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-14 rounded-2xl border border-slate-200/60 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Opret en kunde, registrér tid i en uge, og brug rapporten som
              fakturagrundlag.
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
