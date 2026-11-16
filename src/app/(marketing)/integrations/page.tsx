import {
  AppWindow,
  ArrowRight,
  BookOpen,
  Calendar,
  Globe,
  Puzzle,
  Workflow,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { CTASection } from "@/components/marketing/CTASection";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { PillBadge } from "@/components/marketing/PillBadge";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Integrationer: TimeTrack",
  description:
    "Forbind TimeTrack med Zapier, Make, n8n, Billy, Dinero, e-conomic, Google Kalender og mere. Automatiser din tidsstyring og fakturering.",
  alternates: { canonical: "/integrations" },
};

const automationIntegrations = [
  {
    icon: Zap,
    name: "Zapier",
    tagline: "6.000+ apps, ingen kode",
    description:
      "Automatiser tidsregistreringer, fakturaer og kunder med Zapier. 7 triggers og 5 actions klar til brug.",
    docsHref: "/integrations/zapier",
    color: "orange",
  },
  {
    icon: Workflow,
    name: "Make",
    tagline: "Visuelle workflows",
    description:
      "Byg komplekse automationsscenarier med Makes drag-and-drop interface. Fuld webhook-support.",
    docsHref: "/integrations/make",
    color: "purple",
  },
  {
    icon: Puzzle,
    name: "n8n",
    tagline: "Open source automation",
    description:
      "Self-hosted eller cloud. Brug HTTP Request-noder direkte mod TimeTrack API'et med webhook-triggers.",
    docsHref: "/integrations/n8n",
    color: "red",
  },
];

const accountingIntegrations = [
  {
    icon: Globe,
    name: "Billy",
    tagline: "Dansk regnskab",
    description:
      "Synkroniser kunder og send fakturaer direkte til Billy med ét klik.",
    docsHref: "/billy",
    color: "blue",
  },
  {
    icon: Globe,
    name: "Dinero",
    tagline: "Dansk bogføring",
    description:
      "OAuth-forbindelse til Dinero. Eksportér fakturaer og hold regnskabet opdateret automatisk.",
    docsHref: "/dinero",
    color: "green",
  },
  {
    icon: Globe,
    name: "e-conomic",
    tagline: "Visma økonomi",
    description:
      "Forbind din e-conomic-aftale, og hent dine kunder ind i TimeTrack.",
    docsHref: "/integrations/economic",
    color: "teal",
  },
];

const otherIntegrations = [
  {
    icon: Calendar,
    name: "Google Kalender",
    tagline: "Blokér tid automatisk",
    description:
      "Dine tidsregistreringer oprettes som begivenheder i Google Kalender, så din kalender altid afspejler dit arbejde.",
    docsHref: "/dashboard/settings/integrations",
    color: "blue",
  },
  {
    icon: AppWindow,
    name: "Browserudvidelse",
    tagline: "Chrome + Firefox",
    description:
      "Start og stop timeren direkte fra din browser. Fungerer på alle sider, bl.a. GitHub, Notion og Jira.",
    docsHref: "/browser-extension",
    color: "slate",
  },
  {
    icon: BookOpen,
    name: "REST API",
    tagline: "Byg din egen integration",
    description:
      "Fuld adgang til kunder, projekter, timer, fakturaer og klippekort via et åbent REST API.",
    docsHref: "/developers",
    color: "emerald",
  },
];

const colorMap: Record<string, { bg: string; icon: string; border: string }> = {
  orange: {
    bg: "bg-orange-50",
    icon: "text-orange-600",
    border: "hover:border-orange-200",
  },
  purple: {
    bg: "bg-purple-50",
    icon: "text-purple-600",
    border: "hover:border-purple-200",
  },
  red: {
    bg: "bg-red-50",
    icon: "text-red-600",
    border: "hover:border-red-200",
  },
  blue: {
    bg: "bg-blue-50",
    icon: "text-blue-600",
    border: "hover:border-blue-200",
  },
  green: {
    bg: "bg-green-50",
    icon: "text-green-600",
    border: "hover:border-green-200",
  },
  teal: {
    bg: "bg-teal-50",
    icon: "text-teal-600",
    border: "hover:border-teal-200",
  },
  slate: {
    bg: "bg-slate-100",
    icon: "text-slate-600",
    border: "hover:border-slate-300",
  },
  emerald: {
    bg: "bg-emerald-50",
    icon: "text-emerald-600",
    border: "hover:border-emerald-200",
  },
};

function IntegrationCard({
  icon: Icon,
  name,
  tagline,
  description,
  docsHref,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  tagline: string;
  description: string;
  docsHref: string;
  color: string;
}) {
  const c = colorMap[color] ?? colorMap.slate;
  return (
    <Link
      href={docsHref}
      className={`group flex flex-col rounded-2xl border border-slate-200/60 bg-white p-6 transition-all hover:shadow-md ${c.border}`}
    >
      <div
        className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl ${c.bg} ${c.icon} transition-colors group-hover:opacity-90`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-lg font-semibold text-slate-900">{name}</h3>
        <span className="text-xs text-slate-400">{tagline}</span>
      </div>
      <p className="mb-4 flex-1 text-sm text-slate-600">{description}</p>
      <span
        className={`inline-flex items-center gap-1 text-sm font-medium ${c.icon}`}
      >
        Læs mere
        <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

export default function IntegrationsPage() {
  return (
    <>
      <Navigation />

      <MarketingHero
        badge={<PillBadge>Integrationer</PillBadge>}
        title={
          <>
            TimeTrack forbinder med{" "}
            <span className="text-brand-600">dine værktøjer</span>
          </>
        }
        subtitle="Automatiser din arbejdsgang med Zapier, Make og n8n. Forbind Billy, Dinero og e-conomic. Eller byg din egen integration med TimeTracks åbne API."
      >
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/developers"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-8 py-4 font-semibold text-white transition-all hover:bg-emerald-700 hover:shadow-lg"
          >
            <BookOpen className="h-5 w-5" />
            API dokumentation
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-8 py-4 font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            Opret gratis konto
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </MarketingHero>

      {/* Automation integrations */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Automationsplatforme"
            subtitle="Forbind TimeTrack med tusindvis af apps uden at skrive kode"
          />
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {automationIntegrations.map((integration) => (
              <IntegrationCard key={integration.name} {...integration} />
            ))}
          </div>
        </div>
      </section>

      {/* Accounting integrations */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Regnskabssystemer"
            subtitle="Ét klik forbinder TimeTrack med dit bogføringsprogram"
          />
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {accountingIntegrations.map((integration) => (
              <IntegrationCard key={integration.name} {...integration} />
            ))}
          </div>
        </div>
      </section>

      {/* Other integrations */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Øvrige integrationer"
            subtitle="Kalender, browser og direkte API-adgang"
          />
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {otherIntegrations.map((integration) => (
              <IntegrationCard key={integration.name} {...integration} />
            ))}
          </div>
        </div>
      </section>

      <CTASection
        title="Mangler du en integration?"
        subtitle="TimeTracks API er åbent. Byg det, du har brug for, eller skriv, hvad der mangler."
        primaryHref="/developers"
        primaryLabel="Se API dokumentation"
        secondaryHref="/contact"
        secondaryLabel="Kontakt os"
        checkmarks={["Åbent REST API", "Webhook-support", "100 requests/minut"]}
      />

      <Footer />
    </>
  );
}
