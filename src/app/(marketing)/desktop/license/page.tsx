import type { Metadata } from "next";
import Link from "next/link";
import { DesktopResendKeyForm } from "@/components/desktop/DesktopResendKeyForm";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { TRPCProvider } from "@/providers/trpc-provider";

export const metadata: Metadata = {
  title: "Hent din licensnøgle til TimeTrack Desktop",
  robots: { index: false, follow: false },
};

export default function DesktopLicensePage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <section className="px-4 pt-32 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md">
          <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-slate-900">
            Mistet din licensnøgle?
          </h1>
          <p className="mb-8 text-center text-slate-600">
            Indtast den email du brugte ved købet, så sender vi din licensnøgle
            igen.
          </p>
          <TRPCProvider>
            <DesktopResendKeyForm />
          </TRPCProvider>
          <p className="mt-4 text-center text-sm text-slate-400">
            Har du et TimeTrack Cloud-abonnement? Så finder du licensen under{" "}
            <Link
              href="/dashboard/settings/desktop"
              className="font-medium text-brand-600 hover:underline"
            >
              Indstillinger → Desktop
            </Link>
            .
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
