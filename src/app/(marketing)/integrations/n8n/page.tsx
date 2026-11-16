import { ArrowLeft, BookOpen, Key, Puzzle, Webhook } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { CTASection } from "@/components/marketing/CTASection";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { PillBadge } from "@/components/marketing/PillBadge";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "n8n-integration: TimeTrack",
  description:
    "Forbind TimeTrack med n8n. Open source automationsplatform med fuld webhook-support og direkte REST API adgang.",
  alternates: { canonical: "/integrations/n8n" },
};

const webhookEvents = [
  {
    event: "time_entry.created",
    description: "Ny tidsregistrering oprettet",
  },
  {
    event: "time_entry.updated",
    description: "Tidsregistrering opdateret",
  },
  {
    event: "client.created",
    description: "Ny kunde oprettet",
  },
  {
    event: "invoice.created",
    description: "Ny faktura oprettet",
  },
  {
    event: "invoice.paid",
    description: "Faktura markeret som betalt",
  },
  {
    event: "prepaid.low_balance",
    description: "Klippekort under minimumsgrænse",
  },
  {
    event: "task.completed",
    description: "Opgave markeret som udført",
  },
];

const endpoints = [
  {
    method: "GET",
    path: "/api/v1/me",
    description: "Brugerinfo + API key validering",
  },
  { method: "GET/POST", path: "/api/v1/clients", description: "Kunder" },
  { method: "GET/POST", path: "/api/v1/projects", description: "Projekter" },
  {
    method: "GET/POST",
    path: "/api/v1/time-entries",
    description: "Tidsregistreringer",
  },
  {
    method: "GET/POST/DELETE",
    path: "/api/v1/timer",
    description: "Timer start/stop",
  },
  { method: "GET/POST", path: "/api/v1/invoices", description: "Fakturaer" },
  { method: "GET/POST", path: "/api/v1/tasks", description: "Opgaver" },
  {
    method: "GET/POST/DELETE",
    path: "/api/v1/webhooks",
    description: "Webhook administration",
  },
  {
    method: "GET",
    path: "/api/v1/reports/time-summary",
    description: "Tidsrapport",
  },
  {
    method: "GET",
    path: "/api/v1/reports/revenue",
    description: "Omsætningsrapport",
  },
];

const useCases = [
  {
    title: "Daglig tidsrapport til Slack",
    steps: [
      "Schedule Trigger → Kører kl. 17:00 hver dag",
      "HTTP Request → GET /api/v1/reports/time-summary for i dag",
      "Slack → Send besked til #team-updates med dagens timer",
    ],
  },
  {
    title: "Ny kunde → Google Sheets",
    steps: [
      "Webhook → Modtager client.created fra TimeTrack",
      "Google Sheets → Tilføj ny række med kundens data",
    ],
  },
  {
    title: "Faktura betalt → e-mail",
    steps: [
      "Webhook → Modtager invoice.paid fra TimeTrack",
      'Send Email → Bekræftelse: "Faktura #{{invoiceNumber}} er betalt"',
    ],
  },
  {
    title: "Ugentlig opsummering til Notion",
    steps: [
      "Schedule Trigger → Kører mandag morgen",
      "HTTP Request → GET /api/v1/reports/time-summary for foregående uge",
      "Notion → Opret ny side i projektstatus-database",
    ],
  },
];

export default function N8nIntegrationPage() {
  return (
    <>
      <Navigation />

      <MarketingHero
        badge={<PillBadge>n8n</PillBadge>}
        title={
          <>
            TimeTrack + <span className="text-red-600">n8n</span>
          </>
        }
        subtitle="Open source automationsplatform, self-hosted eller cloud. Forbind TimeTrack med ethvert system via HTTP Request-noder og webhook-triggere."
      >
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard/settings/integrations"
            className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-8 py-4 font-semibold text-white transition-all hover:bg-red-600 hover:shadow-lg"
          >
            <Key className="h-5 w-5" />
            Hent API nøgle
          </Link>
          <Link
            href="/developers"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-8 py-4 font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            <BookOpen className="h-5 w-5" />
            API dokumentation
          </Link>
        </div>
      </MarketingHero>

      {/* Setup */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="Opsætning"
            subtitle="Brug HTTP Request-noder direkte mod TimeTrack API'et"
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Key className="mb-4 h-8 w-8 text-red-500" />
              <h3 className="mb-2 font-semibold text-slate-900">
                1. Opret API nøgle
              </h3>
              <p className="text-sm text-slate-600">
                Gå til TimeTrack → Indstillinger → API Nøgler og opret en nøgle
                til n8n.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Puzzle className="mb-4 h-8 w-8 text-red-500" />
              <h3 className="mb-2 font-semibold text-slate-900">
                2. Konfigurer Header Auth
              </h3>
              <p className="text-sm text-slate-600">
                I n8n: opret en Header Auth credential med{" "}
                <code className="text-xs">
                  Authorization: Bearer tk_live_...
                </code>
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Webhook className="mb-4 h-8 w-8 text-red-500" />
              <h3 className="mb-2 font-semibold text-slate-900">
                3. Tilføj Webhook (valgfrit)
              </h3>
              <p className="text-sm text-slate-600">
                Kopier webhook-URL fra n8n og registrér den i TimeTrack →
                Indstillinger → Webhooks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Webhook events */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Webhook-events"
            subtitle="Events du kan lytte til via en Webhook-node i n8n"
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-2 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Event</span>
              <span>Beskrivelse</span>
            </div>
            {webhookEvents.map((e, i) => (
              <div
                key={e.event}
                className={`grid grid-cols-2 items-center px-6 py-4 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
              >
                <code className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded-md w-fit">
                  {e.event}
                </code>
                <span className="text-slate-600">{e.description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* API Endpoints */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="API Endpoints"
            subtitle="Brug HTTP Request-noder til at kalde disse endpoints direkte"
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Metode</span>
              <span>Endpoint</span>
              <span>Beskrivelse</span>
            </div>
            {endpoints.map((ep, i) => (
              <div
                key={ep.path}
                className={`grid grid-cols-3 items-center px-6 py-4 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
              >
                <span className="text-xs font-medium text-slate-500">
                  {ep.method}
                </span>
                <code className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md w-fit">
                  {ep.path}
                </code>
                <span className="text-slate-600">{ep.description}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-slate-500">
            Base URL: <code className="text-xs">https://timetrack.dk</code>
            {" · "}
            Rate limit: 100 requests/minut
          </p>
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Eksempel-workflows"
            subtitle="Importér eksempel-workflow fra integrations/n8n/ i repositoriet"
          />
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {useCases.map((uc) => (
              <div
                key={uc.title}
                className="rounded-2xl border border-slate-200/60 bg-white p-6"
              >
                <h3 className="mb-4 font-semibold text-slate-900">
                  {uc.title}
                </h3>
                <ol className="space-y-2">
                  {uc.steps.map((step, i) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                      key={i}
                      className="flex items-start gap-3 text-sm text-slate-600"
                    >
                      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Back link */}
      <section className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Link
            href="/integrations"
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Alle integrationer
          </Link>
        </div>
      </section>

      <CTASection
        title="Klar til at automatisere?"
        subtitle="Opret en gratis konto og generer din første API nøgle på under et minut."
        primaryHref="/register"
        primaryLabel="Opret konto"
        secondaryHref="/developers"
        secondaryLabel="Se API dokumentation"
        checkmarks={[
          "Gratis API adgang",
          "Self-hosted eller cloud",
          "Open source",
        ]}
      />

      <Footer />
    </>
  );
}
