import {
  Apple,
  ArrowRight,
  Brain,
  Check,
  Cpu,
  Download,
  Monitor,
  Shield,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { getDesktopReleasesRepo } from "@/lib/release-repos";

// Public releases repo — anonymous GitHub API works because it is public.
const RELEASES_REPO = getDesktopReleasesRepo();
const LATEST_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

interface GithubAsset {
  name: string;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

async function getLatestRelease(): Promise<GithubRelease | null> {
  if (!RELEASES_REPO) return null;
  try {
    // Cache server-side for an hour so we don't hit GitHub on every request.
    const res = await fetch(LATEST_API, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as GithubRelease;
  } catch {
    return null;
  }
}

export const metadata: Metadata = {
  title: "Download TimeTrack Desktop (Beta)",
  description:
    "Tidsregistrering med auto-tracking og AI-klassificering, hvor dine data bliver på din computer. Download desktop-appen til Windows og macOS, nu i Beta.",
  openGraph: {
    title: "Download TimeTrack Desktop (Beta)",
    description:
      "Tidsregistrering med auto-tracking og AI-klassificering, hvor dine data bliver på din computer. Download desktop-appen til Windows og macOS.",
    url: "https://timetrack.dk/download",
    type: "website",
  },
  alternates: { canonical: "/download" },
};

export default async function DownloadPage() {
  const release = await getLatestRelease();
  const winAsset = release?.assets.find((a) => a.name.endsWith("-setup.exe"));
  const macAsset = release?.assets.find((a) => a.name.endsWith(".dmg"));
  const version = release?.tag_name?.replace(/^v/, "");
  const hasDownloads = Boolean(winAsset || macAsset);

  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TimeTrack Desktop",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Windows 10+, macOS 11+",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "DKK",
      description: "Inkluderet i alle TimeTrack-planer, også Gratis",
    },
    description:
      "Privacy-first tidsregistrering med auto-tracking og AI-klassificering for freelancere.",
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <Navigation />

      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-32 pb-20 sm:px-6 lg:px-8">
        <div className="relative mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200/60">
            <Download className="h-4 w-4" />
            Beta: tilgængelig nu
          </div>

          <h1 className="mb-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            TimeTrack Desktop
          </h1>

          <p className="mx-auto mb-10 max-w-xl text-xl text-slate-600">
            Privacy-first tidsregistrering med auto-tracking og
            AI-klassificering. Kører direkte på din computer.
          </p>
        </div>
      </section>

      {/* Feature highlights */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 p-8 text-center transition-shadow hover:shadow-lg">
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

            <div className="rounded-2xl border border-slate-200 p-8 text-center transition-shadow hover:shadow-lg">
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

            <div className="rounded-2xl border border-slate-200 p-8 text-center transition-shadow hover:shadow-lg">
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

      {/* Platforme */}
      <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-8 text-2xl font-bold text-slate-900">Platforme</h2>
          <div className="flex flex-wrap items-center justify-center gap-8">
            <div className="flex items-center gap-2 text-slate-700">
              <Check className="h-5 w-5 text-green-500" />
              <span className="font-medium">Windows</span>
              <span className="text-sm text-slate-500">(klar)</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <Check className="h-5 w-5 text-green-500" />
              <span className="font-medium">macOS</span>
              <span className="text-sm text-slate-500">(klar)</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Cpu className="h-5 w-5" />
              <span className="font-medium">Linux</span>
              <span className="text-sm">(planlagt)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pris */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-4 text-2xl font-bold text-slate-900">
            Inkluderet i alle planer
          </h2>
          <p className="mb-8 text-lg text-slate-600">
            Desktop-appen følger med i alle TimeTrack-planer, også Gratis. Ingen
            ekstra betaling.
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

      {/* Download */}
      <section id="download" className="bg-brand-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl text-center">
          <Download className="mx-auto mb-4 h-10 w-10 text-brand-600" />
          <h2 className="mb-2 text-2xl font-bold text-slate-900">
            Download til din computer
          </h2>
          {hasDownloads ? (
            <>
              <p className="mb-8 text-slate-600">
                Appen er i Beta og kan indeholde fejl
                {version ? ` · seneste version v${version}` : ""}.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {winAsset && (
                  <a
                    href={winAsset.browser_download_url}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700"
                  >
                    <Monitor className="h-5 w-5" />
                    Download til Windows
                  </a>
                )}
                {macAsset && (
                  <a
                    href={macAsset.browser_download_url}
                    className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-6 py-3 font-medium text-brand-700 transition-colors hover:bg-brand-50"
                  >
                    <Apple className="h-5 w-5" />
                    Download til macOS
                  </a>
                )}
              </div>
              <p className="mt-6 text-sm text-slate-500">
                Stødt på en fejl? Brug "Indberet fejl eller mangel" inde i
                appen.
              </p>
            </>
          ) : (
            <p className="text-slate-600">
              Download er midlertidigt utilgængelig. Prøv igen om lidt, eller
              brug TimeTrack i din browser i mellemtiden.
            </p>
          )}
        </div>
      </section>

      {/* Systemkrav */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-6 text-center text-2xl font-bold text-slate-900">
            Systemkrav
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
            Foretrækker du browseren? Brug TimeTrack direkte i din browser.
          </p>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 font-medium text-white transition-colors hover:bg-slate-800"
          >
            Prøv TimeTrack gratis
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
