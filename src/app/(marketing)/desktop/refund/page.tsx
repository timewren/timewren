import type { Metadata } from "next";
import { DesktopRefundForm } from "@/components/desktop/DesktopRefundForm";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { DESKTOP_REFUND_WINDOW_DAYS } from "@/lib/config";
import { TRPCProvider } from "@/providers/trpc-provider";

export const metadata: Metadata = {
  title: "Refundering af TimeTrack Desktop",
  robots: { index: false, follow: false },
};

export default function DesktopRefundPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <section className="px-4 pt-32 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md">
          <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-slate-900">
            Fortryd dit køb
          </h1>
          <p className="mb-8 text-center text-slate-600">
            Inden for {DESKTOP_REFUND_WINDOW_DAYS} dage kan du få alle pengene
            retur. Indtast din licensnøgle og købsemail, så ordner vi resten.
          </p>
          <TRPCProvider>
            <DesktopRefundForm />
          </TRPCProvider>
          <p className="mt-4 text-center text-xs text-slate-400">
            Din licens deaktiveres med det samme. Brug for hjælp? Kontakt
            support.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
