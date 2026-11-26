import {
  Apple,
  ArrowRight,
  Brain,
  Globe,
  Monitor,
  Shield,
  Smartphone,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { AppStoreBadge } from "@/components/marketing/AppStoreBadge";
import { Navigation } from "@/components/Navigation";
import { playStoreUrl } from "@/lib/app-stores";
import { brand } from "@/lib/brand";
import { getBrandId } from "@/lib/brand-id";
import { appLinkHref, getMarketingUrl } from "@/lib/config";
import {
  type DesktopInstallers,
  getDesktopInstallers,
} from "@/lib/desktop-installers";
import {
  DOWNLOAD_TARGETS,
  type DownloadTarget,
  featuredTarget,
  requestDevice,
} from "@/lib/device-detect";
import {
  isTimeTrackCloud,
  usesRuntimeInstancePages,
} from "@/lib/marketing-guard";

const DESCRIPTION =
  "Hent appen til iPhone og iPad i App Store, desktop-appen til Windows og macOS, eller brug webappen i browseren. Én konto på alle enheder.";

export const metadata: Metadata = {
  title: "Hent appen til iPhone, Mac og Windows",
  description: DESCRIPTION,
  openGraph: {
    title: "Hent TimeTrack til iPhone, Mac og Windows",
    description: DESCRIPTION,
    url: "https://timetrack.dk/download",
    type: "website",
  },
  alternates: { canonical: "/download" },
};

const PLATFORMS: Record<
  DownloadTarget,
  { name: string; body: string; icon: typeof Apple }
> = {
  ios: {
    name: "iPhone og iPad",
    body: "Start og stop timeren, skriv tid ind for tidligere dage, og se ugens og månedens timer. Appen kan bruges uden konto.",
    icon: Smartphone,
  },
  android: {
    name: "Android",
    body: "Android-appen er i test og kommer i Google Play. Indtil da virker webappen på telefonen, og du kan lægge den på hjemmeskærmen.",
    icon: Smartphone,
  },
  mac: {
    name: "macOS",
    body: "Desktop-appen med auto-tracking og AI-klassificering. Kræver macOS 11 eller nyere.",
    icon: Apple,
  },
  windows: {
    name: "Windows",
    body: "Desktop-appen med auto-tracking og AI-klassificering. Kræver Windows 10 eller nyere.",
    icon: Monitor,
  },
  web: {
    name: "Webappen",
    body: "Virker i alle moderne browsere, også på Linux og Chromebook. Alle funktioner, ingen installation.",
    icon: Globe,
  },
};

/** The Android text once the Play listing is public (`playLive`). */
const ANDROID_LIVE_BODY =
  "Start og stop timeren, skriv tid ind for tidligere dage, og se ugens og månedens timer. Appen kan bruges uden konto.";

function platformBody(target: DownloadTarget): string {
  return target === "android" && playStoreUrl(getBrandId())
    ? ANDROID_LIVE_BODY
    : PLATFORMS[target].body;
}

const FEATURED_HEADING = {
  iphone: "Til din iPhone",
  ipad: "Til din iPad",
  android: "Til din Android-telefon",
  mac: "Til din Mac",
  windows: "Til din Windows-pc",
  web: "I din browser",
} as const;

const primaryButton =
  "inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-700";
const secondaryButton =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-200 bg-white px-5 py-2.5 font-medium text-brand-700 transition-colors hover:bg-brand-50";

function Actions({
  target,
  installers,
  featured = false,
}: {
  target: DownloadTarget;
  installers: DesktopInstallers;
  featured?: boolean;
}) {
  const storeBrand = getBrandId();
  const fallback = installers.releasePage ? (
    <a
      href={installers.releasePage}
      className="font-medium text-brand-700 underline underline-offset-2"
    >
      Alle filer på GitHub
    </a>
  ) : (
    <p className="text-sm text-slate-600">
      Download er midlertidigt utilgængelig. Prøv igen om lidt, eller brug{" "}
      {brand.name} i din browser i mellemtiden.
    </p>
  );
  switch (target) {
    case "ios":
      // The store app signs in to the Cloud; it cannot point at another
      // server yet (README, Apps), so a self-hosted instance offers the web app.
      return !isTimeTrackCloud() ? (
        <p className="text-sm text-slate-600">
          Appen i App Store virker med {brand.name} Cloud og kan endnu ikke
          forbinde til denne server. Brug webappen i telefonens browser, og læg
          den på hjemmeskærmen.
        </p>
      ) : (
        <AppStoreBadge
          brand={storeBrand}
          height={featured ? 54 : 48}
          eager={featured}
        />
      );
    case "android": {
      const play = playStoreUrl(storeBrand);
      return play ? (
        <a href={play} className={primaryButton}>
          Hent i Google Play
        </a>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm font-medium text-slate-600">
            Kommer snart i Google Play
          </span>
          {featured ? (
            <Link href={appLinkHref("/login")} className={secondaryButton}>
              Åbn webappen
            </Link>
          ) : null}
        </div>
      );
    }
    case "mac":
      return installers.macArm && installers.macIntel ? (
        <div className="flex flex-wrap gap-3">
          <a href={installers.macArm} className={primaryButton}>
            <Apple className="h-5 w-5" aria-hidden />
            Download til Apple silicon
          </a>
          <a href={installers.macIntel} className={secondaryButton}>
            Download til Intel
          </a>
        </div>
      ) : (
        fallback
      );
    case "windows":
      return installers.windows ? (
        <a href={installers.windows} className={primaryButton}>
          <Monitor className="h-5 w-5" aria-hidden />
          Download til Windows
        </a>
      ) : (
        fallback
      );
    case "web":
      return (
        <div className="flex flex-wrap gap-3">
          <Link href={appLinkHref("/register")} className={primaryButton}>
            Prøv gratis
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href={appLinkHref("/login")} className={secondaryButton}>
            Log ind
          </Link>
        </div>
      );
  }
}

/**
 * Én downloadside for alle platforme. Enheden gættes på serveren ud fra
 * User-Agent og Sec-CH-UA-Platform (src/lib/device-detect.ts), så det virker
 * uden klient-JS, og det store kort viser den. Alle platforme står altid i
 * gitteret nedenunder, så et forkert gæt ikke låser nogen ude.
 */
export default async function DownloadPage() {
  const [device, installers] = await Promise.all([
    requestDevice(),
    getDesktopInstallers(getBrandId()),
  ]);
  const featured = featuredTarget(device);
  const heading =
    featured === "ios"
      ? device.iosDevice === "ipad"
        ? "ipad"
        : "iphone"
      : featured;
  const isDesktop = featured === "mac" || featured === "windows";
  const FeaturedIcon = PLATFORMS[featured].icon;

  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: brand.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "iOS, iPadOS, Windows 10+, macOS 11+, Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "DKK",
      description: `Apps til telefon og computer er inkluderet i alle ${brand.name}-planer, også Gratis`,
    },
    description:
      "Tidsregistrering med klippekort og fakturering for freelancere, på telefon, computer og i browseren.",
    publisher: {
      "@type": "Organization",
      name: brand.name,
      url: usesRuntimeInstancePages()
        ? getMarketingUrl()
        : "https://timetrack.dk",
    },
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD escapes HTML tag starts
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
        }}
      />
      <Navigation />

      {/* Hero og enhedens kort */}
      <section className="bg-white px-4 pt-28 pb-12 sm:px-6 sm:pt-32 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Hent {brand.name}
          </h1>
          <p className="mb-10 max-w-xl text-lg text-slate-600 sm:text-xl">
            Én konto på telefon, computer og i browseren. Start timeren på
            telefonen, og stop den på computeren.
          </p>

          <section
            aria-labelledby="dl-featured"
            data-target={featured}
            className="rounded-2xl bg-brand-50 p-6 ring-1 ring-brand-100 sm:p-8"
          >
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand-600 ring-1 ring-brand-100">
                <FeaturedIcon className="h-6 w-6" aria-hidden />
              </span>
              <h2
                id="dl-featured"
                className="text-2xl font-bold text-slate-900"
              >
                {FEATURED_HEADING[heading]}
              </h2>
            </div>
            <p className="mb-6 max-w-xl text-slate-700">
              {platformBody(featured)}
            </p>
            <Actions target={featured} installers={installers} featured />
            {isDesktop && installers.version ? (
              <p className="mt-4 text-sm text-slate-600">
                Seneste version er v{installers.version}.
              </p>
            ) : null}
            {featured === "mac" ? (
              <p className="mt-3 text-sm text-slate-600">
                Hvilken skal du vælge? Åbn Apple-menuen, og vælg Om denne Mac.
                Står der en chip som Apple M1 eller nyere, er det Apple silicon.
                Står der Intel, er det Intel.
              </p>
            ) : null}
            {featured === "mac" && isTimeTrackCloud() ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-brand-100 pt-5">
                <p className="text-sm text-slate-700">
                  Er du på en iPad? Appen til iPhone og iPad ligger i App Store.
                </p>
                <AppStoreBadge brand={getBrandId()} height={40} />
              </div>
            ) : null}
            <p className="mt-5 text-sm text-slate-500">
              Enheden er gættet ud fra browseren. Alle platforme står nedenfor.
            </p>
          </section>
        </div>
      </section>

      {/* Alle platforme */}
      <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-2xl font-bold text-slate-900">
            Alle platforme
          </h2>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DOWNLOAD_TARGETS.map((target) => {
              const Icon = PLATFORMS[target].icon;
              return (
                <li
                  key={target}
                  data-target={target}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-brand-600" aria-hidden />
                    <h3 className="text-lg font-bold text-slate-900">
                      {PLATFORMS[target].name}
                    </h3>
                  </div>
                  <p className="text-sm text-slate-600">
                    {platformBody(target)}
                  </p>
                  <div className="mt-auto pt-2">
                    <Actions target={target} installers={installers} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-sm text-slate-600">
            Linux-udgaven af desktop-appen er planlagt. Stødt på en fejl i
            desktop-appen? Brug "Indberet fejl eller mangel" inde i appen.
          </p>
        </div>
      </section>

      {/* Desktop-appen */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 max-w-2xl">
            <h2 className="mb-3 text-2xl font-bold text-slate-900">
              {brand.name} Desktop
            </h2>
            <p className="text-lg text-slate-600">
              Privacy-first tidsregistrering med auto-tracking og
              AI-klassificering. Kører direkte på din computer.{" "}
              <Link
                href="/desktop"
                className="font-medium text-brand-700 underline underline-offset-2"
              >
                Læs mere om desktop-appen
              </Link>
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50">
                <Monitor className="h-7 w-7 text-brand-600" />
              </div>
              <h3 className="mb-2 text-lg font-bold text-slate-900">
                Auto-tracking
              </h3>
              <p className="text-sm text-slate-600">
                Din tid spores automatisk baseret på de programmer og websites
                du bruger. Ingen manuel start/stop.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50">
                <Brain className="h-7 w-7 text-brand-600" />
              </div>
              <h3 className="mb-2 text-lg font-bold text-slate-900">
                AI-klassificering
              </h3>
              <p className="text-sm text-slate-600">
                AI sorterer automatisk din tid i de rigtige projekter og kunder.
                BYOK eller lokal LLM via Ollama.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-green-50">
                <Shield className="h-7 w-7 text-green-600" />
              </div>
              <h3 className="mb-2 text-lg font-bold text-slate-900">
                Privacy-first
              </h3>
              <p className="text-sm text-slate-600">
                Dine aktivitetsdata forlader aldrig din computer. Skærmbilleder,
                app-historik og keystroke-data forbliver lokalt.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pris */}
      <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-4 text-2xl font-bold text-slate-900">
            Inkluderet i alle planer
          </h2>
          <p className="mb-8 text-lg text-slate-600">
            Apps til telefon og computer følger med i alle {brand.name}-planer,
            også Gratis. Ingen ekstra betaling.
          </p>
          <div className="mx-auto max-w-sm">
            <Link
              href="/pricing"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Se planer og priser
            </Link>
          </div>
        </div>
      </section>

      {/* Systemkrav */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-6 text-center text-2xl font-bold text-slate-900">
            Systemkrav til desktop-appen
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-5">
              <p className="mb-1 font-semibold text-slate-900">Windows</p>
              <p className="text-sm text-slate-600">Windows 10 eller nyere</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <p className="mb-1 font-semibold text-slate-900">macOS</p>
              <p className="text-sm text-slate-600">
                macOS 11 (Big Sur) eller nyere
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <p className="mb-1 font-semibold text-slate-900">RAM</p>
              <p className="text-sm text-slate-600">Minimum 4 GB</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-5">
              <p className="mb-1 font-semibold text-slate-900">Disk</p>
              <p className="text-sm text-slate-600">100 MB ledig plads</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-4 text-slate-600">
            Foretrækker du browseren? Brug {brand.name} direkte i din browser.
          </p>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 font-medium text-white transition-colors hover:bg-slate-800"
          >
            Prøv {brand.name} gratis
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
