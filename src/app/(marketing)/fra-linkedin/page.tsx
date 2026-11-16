import { ArrowRight, Check, Clock, CreditCard, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Velkommen fra LinkedIn",
  description: `TimeTrack er timeregistrering bygget til danske freelancere. Klippekort, rapporter og fakturagrundlag fra ${PLAN_PRICES.selvstaendig.price} ekskl. moms. Gratis at starte.`,
  robots: { index: false, follow: false },
};

const benefits = [
  {
    icon: Clock,
    title: "Track tid på 2 sekunder",
    description:
      "Start/stop timer eller log manuelt. Aldrig mere glemte timer.",
  },
  {
    icon: CreditCard,
    title: "Klippekort / prepaid timer",
    description:
      "Sælg timer på forhånd. Kunden ser saldo, du ser forbrug. Automatisk.",
  },
  {
    icon: Users,
    title: "Rapporter kunden kan forstå",
    description:
      "Send en timerapport med ét klik. Kunden ser præcis hvad tiden gik til.",
  },
];

export default function FraLinkedInPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        {/* Personal greeting */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Tak fordi du klikkede
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-lg text-slate-600">
            Jeg hedder Mads og har bygget TimeTrack til freelancere som mig
            selv, fordi de eksisterende værktøjer enten var for dyre eller for
            besværlige.
          </p>
        </div>

        {/* Benefits */}
        <div className="mt-12 space-y-6">
          {benefits.map((b) => (
            <div key={b.title} className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <b.icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">{b.title}</h2>
                <p className="mt-0.5 text-sm text-slate-600">{b.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 rounded-2xl bg-slate-50 p-8 text-center">
          <p className="text-2xl font-bold text-slate-900">
            Fra {PLAN_PRICES.selvstaendig.price}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Ekskl. moms. Gratis at starte, intet betalingskort
          </p>
          <Link
            href="/register?utm_source=linkedin&utm_medium=social&utm_campaign=landing"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg"
          >
            Start gratis
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>

        {/* Trust signals */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
          {[
            "Ingen binding",
            "GDPR-compliant",
            "Dansk support",
            "Billy/Dinero integration",
          ].map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-green-500" />
              {s}
            </span>
          ))}
        </div>

        {/* Social proof */}
        <p className="mt-8 text-center text-sm text-slate-400">
          Brugt af freelancere, konsulenter og små bureauer i hele Danmark
        </p>
      </main>

      <Footer />
    </div>
  );
}
