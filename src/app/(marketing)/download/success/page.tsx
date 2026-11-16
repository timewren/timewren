import { ArrowRight, CheckCircle2, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Tak for dit køb af TimeTrack Desktop",
  // Order-confirmation page; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default function DownloadSuccessPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <section className="relative overflow-hidden bg-white px-4 pt-32 pb-24 sm:px-6 lg:px-8">
        <div className="relative mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" />
          </div>

          <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Tak for dit køb!
          </h1>

          <p className="mx-auto mb-8 max-w-md text-lg text-slate-600">
            Din licensnøgle er sendt til din email. Hent appen, indsæt nøglen,
            og kom i gang.
          </p>

          <div className="mb-10 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 text-left">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <p className="text-sm font-medium text-slate-900">
                Tjek din indbakke
              </p>
              <p className="text-sm text-slate-600">
                Mailen med din nøgle (TT-XXXX-XXXX-XXXX-XXXX) kommer typisk
                inden for et par minutter. Husk at kigge i spam, hvis du ikke
                ser den.
              </p>
            </div>
          </div>

          <Link
            href="/download"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Gå til download
            <ArrowRight className="h-5 w-5" />
          </Link>

          <p className="mt-6 text-sm text-slate-500">
            Fuld returret inden for 30 dage: fortryder du, får du alle pengene
            retur via{" "}
            <Link
              href="/desktop/refund"
              className="font-medium text-brand-600 hover:underline"
            >
              refunderingssiden
            </Link>
            .
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
