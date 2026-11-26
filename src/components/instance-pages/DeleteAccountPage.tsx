import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import { brand } from "@/lib/brand";
import { appUrl, getAppUrl } from "@/lib/config";
import { usesRuntimeInstancePages } from "@/lib/marketing-guard";

// Google Play kræver en offentlig side, hvor brugere kan se, hvordan de sletter
// deres konto og data, også uden appen installeret (Data safety → Account deletion).
export const metadata: Metadata = {
  title: "Slet din konto",
  description:
    "Sådan sletter du din TimeTrack-konto og dine data i appen, på web eller ved at skrive til os, og hvad der slettes.",
  alternates: { canonical: "/slet-konto" },
};

export default async function DeleteAccountPage() {
  const runtime = usesRuntimeInstancePages();
  const t = runtime
    ? await getTranslations({ locale: "da", namespace: "chrome.instance" })
    : null;
  const settingsUrl = runtime
    ? appUrl("/dashboard/settings")
    : "https://app.timetrack.dk/dashboard/settings";
  const settingsHost = runtime ? new URL(getAppUrl()).host : "app.timetrack.dk";
  const email = runtime ? brand.supportEmail : "timetrack@timetrack.dk";
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        title="Slet din konto"
        subtitle={`Sådan sletter du din ${brand.name}-konto og dine data`}
      />

      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="typeset typeset-doc mx-auto max-w-4xl">
          <h2 className="mb-4 mt-4 text-2xl font-bold text-slate-900">
            I appen (iPhone og Android)
          </h2>
          <ol className="mt-4 space-y-2 text-slate-600">
            <li>1. Åbn {brand.name}, og gå til fanen Mere.</li>
            <li>2. Tryk på Profil og derefter Slet konto.</li>
            <li>
              3. Skriv din e-mail for at bekræfte, og tryk Slet konto permanent.
            </li>
          </ol>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            På web
          </h2>
          <p className="text-slate-600">
            Log ind på{" "}
            <a
              href={settingsUrl}
              className="text-brand-600 hover:text-brand-700"
            >
              {settingsHost}
            </a>
            , gå til Indstillinger, og vælg Slet konto nederst på siden.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Uden at logge ind
          </h2>
          <p className="text-slate-600">
            Skriv til{" "}
            <a
              href={`mailto:${email}?subject=Slet%20min%20konto`}
              className="text-brand-600 hover:text-brand-700"
            >
              {email}
            </a>{" "}
            fra den e-mail, kontoen er oprettet med.{" "}
            {runtime
              ? t?.("deleteAccountHelp")
              : "Vi sletter kontoen inden for 30 dage og bekræfter det på e-mail."}
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Hvad der slettes
          </h2>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              Din konto, dit navn, din e-mail og dine login-forbindelser (også
              Sign in with Apple, som tilbagekaldes hos Apple).
            </li>
            <li>
              Er du alene i din organisation, slettes den med alle
              tidsregistreringer, kunder, projekter, fakturaer og klippekort.
            </li>
            <li>
              Er du med i et team, bliver dine registreringer i teamet uden dit
              navn, så teamets regnskab stadig hænger sammen.
            </li>
            <li>
              Bogføringsdata, vi er forpligtet til at gemme efter
              bogføringsloven (5 år), opbevares, indtil fristen udløber. Læs
              mere i{" "}
              <a
                href="/privacy"
                className="text-brand-600 hover:text-brand-700"
              >
                privatlivspolitikken
              </a>
              .
            </li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Abonnement købt i App Store eller Google Play
          </h2>
          <p className="text-slate-600">
            Et abonnement købt i appen stopper ikke af sig selv, når kontoen
            slettes. Opsig det i App Store eller Google Play, før du sletter
            kontoen.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
