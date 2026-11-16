import type { Metadata } from "next";

import Link from "next/link";

import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import { TRPCProvider } from "@/providers/trpc-provider";
import { RoadmapBoard } from "./RoadmapBoard";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "Roadmap for TimeTrack: se hvad der er live, hvad jeg bygger lige nu, og hvad der er planlagt. Har du en idé? Skriv til mig.",
  alternates: { canonical: "/roadmap" },
};

export default function RoadmapPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <Navigation />

      <MarketingHero
        title="Roadmap"
        subtitle="Det her er den åbne backlog: hvad der er live, hvad jeg arbejder på nu, og hvad jeg gerne vil bygge."
      >
        <p className="mt-3 text-sm text-slate-500">
          Note: Roadmap&apos;en er et løfte om retning og ikke en garanti for
          datoer.
        </p>
      </MarketingHero>

      {/* Context / expectations */}
      <section className="border-b bg-white px-4 py-10 sm:px-6 lg:px-8 dark:bg-slate-950">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200/60 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-white">
              Fokus lige nu
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Timeregistrering → fakturagrundlag + klippekort/prepaid flows.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/60 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-white">
              Det der allerede virker
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Hold det simpelt: track tid pr. kunde/projekt, lav rapport, og
              brug den som dokumentation når du fakturerer.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/60 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-white">
              Har du input?
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Hvis du savner noget, så skriv til mig. Jeg prioriterer ud fra
              konkrete use cases.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="inline-flex items-center justify-center rounded-xl bg-tt-gran px-4 py-2 text-sm font-semibold text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
              >
                Kontakt mig
              </Link>
              <Link
                href="/changelog"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200/60 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Se changelog
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Roadmap Board */}
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <TRPCProvider>
            <RoadmapBoard />
          </TRPCProvider>
        </div>
      </section>

      <Footer />
    </div>
  );
}
