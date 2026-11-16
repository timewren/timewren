import type { Metadata } from "next";

import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Cookie Politik",
  description:
    "Cookie politik for TimeTrack: vi bruger kun nødvendige cookies. Vores analytics (Plausible) er cookieløs. Læs mere om cookies og privatliv.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        title="Cookie Politik"
        subtitle="Sidst opdateret: 1. marts 2026"
      />

      {/* Content Section */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="typeset typeset-doc mx-auto max-w-4xl">
          <div className="rounded-2xl border border-green-200 bg-green-50 p-6">
            <p className="text-sm text-slate-700">
              <strong>TL;DR:</strong> Vi bruger kun absolut nødvendige cookies.
              Ingen tracking, ingen marketing cookies, ingen analytics cookies.
              Vores analytics (Plausible) er 100% cookieløs.
            </p>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Hvad Er Cookies?
          </h2>
          <p className="text-slate-600">
            Cookies er små tekstfiler, der gemmes på din enhed når du besøger et
            website. De bruges til at huske dine præferencer og give dig en
            bedre brugeroplevelse.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Hvilke Cookies Bruger Vi?
          </h2>
          <p className="text-slate-600">
            TimeTrack har en meget minimal cookie-politik. Vi bruger kun absolut
            nødvendige cookies til at få platformen til at fungere.
          </p>

          <div className="mt-8 space-y-6">
            {/* Nødvendige Cookies */}
            <div className="rounded-2xl border border-slate-200/60 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-slate-900">
                  Nødvendige Cookies
                </h3>
                <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">
                  Kan ikke fravælges
                </span>
              </div>
              <p className="mb-4 text-slate-600">
                Disse cookies er nødvendige for at platformen kan fungere. Uden
                disse cookies kan du ikke logge ind eller bruge TimeTrack.
              </p>

              <div className="overflow-hidden rounded-2xl border border-slate-200/60">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">
                        Cookie
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">
                        Formål
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">
                        Varighed
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="px-4 py-3 text-sm font-mono text-slate-900">
                        session
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        Holder dig logget ind
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        7 dage
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-sm font-mono text-slate-900">
                        cookie_consent
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        Husker dine cookie præferencer
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">1 år</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Statistik "Cookies" (Cookieløs) */}
            <div className="rounded-2xl border border-green-200 bg-green-50 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-slate-900">
                  Statistik (Cookieløs)
                </h3>
                <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
                  Ingen cookies
                </span>
              </div>
              <p className="mb-4 text-slate-600">
                Vi bruger Plausible Analytics til at forstå hvordan brugere
                anvender TimeTrack. Plausible er 100% cookieløs og respekterer
                dit privatliv.
              </p>

              <div className="space-y-3 text-sm text-slate-700">
                <div className="flex items-start gap-2">
                  <span className="text-green-600">✓</span>
                  <span>Ingen cookies - overhovedet</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600">✓</span>
                  <span>Ingen tracking på tværs af websites</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600">✓</span>
                  <span>Respekterer Do Not Track (DNT)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600">✓</span>
                  <span>Anonymiseret data - kan ikke identificere dig</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600">✓</span>
                  <span>Selfhosted - ingen data deles med tredjeparter</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600">✓</span>
                  <span>GDPR-compliant by design</span>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-600">
                Læs mere om Plausible:{" "}
                <a
                  href="https://plausible.io/privacy-focused-web-analytics"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:text-brand-700"
                >
                  plausible.io/privacy-focused-web-analytics
                </a>
              </p>
            </div>

            {/* Marketing Cookies */}
            <div className="rounded-2xl border border-slate-200/60 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-slate-900">
                  Marketing Cookies
                </h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
                  Ikke i brug
                </span>
              </div>
              <p className="text-slate-600">
                Vi bruger IKKE marketing cookies. Vi tracker dig ikke med
                Facebook Pixel, Google Ads, eller andre advertising-værktøjer.
              </p>
            </div>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Hvad Vi IKKE Bruger
          </h2>
          <p className="text-slate-600">
            For at være helt transparent, her er en liste over ting vi bevidst
            har valgt IKKE at bruge:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              <strong>✗ Google Analytics</strong> - Vi bruger Plausible i stedet
            </li>
            <li>
              <strong>✗ Facebook Pixel</strong> - Ingen social media tracking
            </li>
            <li>
              <strong>✗ Google Ads remarketing</strong> - Vi følger dig ikke
              rundt på nettet
            </li>
            <li>
              <strong>✗ Hotjar eller lignende</strong> - Ingen session
              recordings
            </li>
            <li>
              <strong>✗ Google Fonts fra CDN</strong> - Alle fonts hostes lokalt
            </li>
            <li>
              <strong>✗ Tredjeparte CDN scripts</strong> - Alt hostes på vores
              egne servere
            </li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Administrer Dine Cookie Præferencer
          </h2>
          <p className="text-slate-600">
            Selvom vi kun bruger nødvendige cookies, kan du altid slette cookies
            i din browser-indstillinger:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              <strong>Chrome:</strong> Indstillinger → Privatliv og sikkerhed →
              Slet browserdata
            </li>
            <li>
              <strong>Firefox:</strong> Indstillinger → Privatliv og sikkerhed →
              Cookies og webstedsdata
            </li>
            <li>
              <strong>Safari:</strong> Indstillinger → Privatliv → Håndter
              webstedsdata
            </li>
            <li>
              <strong>Edge:</strong> Indstillinger → Cookies og
              webstedstilladelser
            </li>
          </ul>

          <div className="mt-8 rounded-2xl bg-slate-50 p-6">
            <p className="text-sm text-slate-600">
              <strong>Bemærk:</strong> Hvis du sletter nødvendige cookies, vil
              du blive logget ud af TimeTrack og skal logge ind igen.
            </p>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Ændringer Til Denne Politik
          </h2>
          <p className="text-slate-600">
            Vi kan opdatere denne cookie-politik fra tid til anden. Væsentlige
            ændringer vil blive notificeret via email eller gennem platformen.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            Spørgsmål?
          </h2>
          <p className="text-slate-600">
            Hvis du har spørgsmål om vores brug af cookies, er du velkommen til
            at kontakte os:
          </p>
          <div className="mt-4 rounded-2xl bg-slate-50 p-6">
            <p className="text-slate-700">
              <strong>Email:</strong>{" "}
              <a
                href="mailto:timetrack@timetrack.dk"
                className="text-brand-600 hover:text-brand-700"
              >
                timetrack@timetrack.dk
              </a>
            </p>
          </div>

          <div className="mt-12 rounded-2xl border-2 border-brand-600 bg-brand-50 p-8">
            <h3 className="mb-4 text-xl font-bold text-slate-900">
              Relaterede Politikker
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/privacy"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3 font-semibold text-slate-900 shadow-sm transition-colors hover:bg-slate-50"
              >
                Privatlivspolitik
              </Link>
              <Link
                href="/gdpr"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3 font-semibold text-slate-900 shadow-sm transition-colors hover:bg-slate-50"
              >
                GDPR Compliance
              </Link>
              <Link
                href="/terms"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3 font-semibold text-slate-900 shadow-sm transition-colors hover:bg-slate-50"
              >
                Servicevilkår
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
