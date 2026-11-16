import { ArrowLeft, BookOpen, Key, Webhook, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { CTASection } from "@/components/marketing/CTASection";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { PillBadge } from "@/components/marketing/PillBadge";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Zapier-integration: TimeTrack",
  description:
    "Forbind TimeTrack med 6.000+ apps via Zapier. 7 triggers, 5 actions og 2 searches. Ingen kode krævet.",
  alternates: { canonical: "/integrations/zapier" },
};

const triggers = [
  {
    label: "New Time Entry",
    event: "time_entry.created",
    description: "Ny tidsregistrering oprettet",
  },
  {
    label: "Time Entry Updated",
    event: "time_entry.updated",
    description: "Eksisterende tidsregistrering ændret",
  },
  {
    label: "New Client",
    event: "client.created",
    description: "Ny kunde oprettet",
  },
  {
    label: "New Invoice",
    event: "invoice.created",
    description: "Ny faktura oprettet",
  },
  {
    label: "Invoice Paid",
    event: "invoice.paid",
    description: "Faktura markeret som betalt",
  },
  {
    label: "Prepaid Package Low Balance",
    event: "prepaid.low_balance",
    description: "Klippekort under minimumsgrænse",
  },
  {
    label: "Task Completed",
    event: "task.completed",
    description: "Opgave markeret som udført",
  },
];

const actions = [
  {
    label: "Create Time Entry",
    endpoint: "POST /api/v1/time-entries",
    description: "Opret en ny tidsregistrering",
  },
  {
    label: "Create Client",
    endpoint: "POST /api/v1/clients",
    description: "Opret en ny kunde",
  },
  {
    label: "Create Task",
    endpoint: "POST /api/v1/tasks",
    description: "Opret en ny opgave under et projekt",
  },
  {
    label: "Start Timer",
    endpoint: "POST /api/v1/timer",
    description: "Start en løbende timer",
  },
  {
    label: "Stop Timer",
    endpoint: "DELETE /api/v1/timer",
    description: "Stop den aktive timer",
  },
];

const searches = [
  {
    label: "Find Client",
    endpoint: "GET /api/v1/clients?q=",
    description: "Find kunde via navn eller e-mail",
  },
  {
    label: "Find Project",
    endpoint: "GET /api/v1/projects?clientId=",
    description: "Find projekter tilknyttet en kunde",
  },
];

const useCases = [
  {
    title: "Ny tidsregistrering → Google Sheets",
    steps: [
      "Trigger: New Time Entry (TimeTrack)",
      "Action: Create Spreadsheet Row (Google Sheets) med date, hours og description",
    ],
  },
  {
    title: "Faktura betalt → Slack",
    steps: [
      "Trigger: Invoice Paid (TimeTrack)",
      'Action: Send Channel Message (Slack) med teksten "Faktura {{invoiceNumber}} er betalt"',
    ],
  },
  {
    title: "Klippekort lav saldo → Email",
    steps: [
      "Trigger: Prepaid Package Low Balance (TimeTrack)",
      "Action: Send Email, der advarer kunden om, at saldoen er lav",
    ],
  },
  {
    title: "Ny Notion-opgave → TimeTrack",
    steps: [
      "Trigger: New Database Item (Notion)",
      "Action: Create Task (TimeTrack), så opgaver synkroniseres automatisk",
    ],
  },
];

export default function ZapierIntegrationPage() {
  return (
    <>
      <Navigation />

      <MarketingHero
        badge={<PillBadge>Zapier</PillBadge>}
        title={
          <>
            TimeTrack + <span className="text-orange-600">Zapier</span>
          </>
        }
        subtitle="Forbind TimeTrack med 6.000+ apps. Automatiser tidsregistreringer, fakturaer og kunder. Ingen kode krævet."
      >
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard/settings/integrations"
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-8 py-4 font-semibold text-white transition-all hover:bg-orange-600 hover:shadow-lg"
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

      {/* Triggers */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Triggers"
            subtitle="Webhook-baserede: Zapier registrerer og afmelder automatisk"
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Trigger</span>
              <span>Event</span>
              <span>Beskrivelse</span>
            </div>
            {triggers.map((t, i) => (
              <div
                key={t.event}
                className={`grid grid-cols-3 items-center px-6 py-4 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
              >
                <span className="font-medium text-slate-900">{t.label}</span>
                <code className="text-xs text-orange-700 bg-orange-50 px-2 py-1 rounded-md w-fit">
                  {t.event}
                </code>
                <span className="text-slate-600">{t.description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Actions */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Actions"
            subtitle="Opret data i TimeTrack fra andre apps"
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Action</span>
              <span>Endpoint</span>
              <span>Beskrivelse</span>
            </div>
            {actions.map((a, i) => (
              <div
                key={a.label}
                className={`grid grid-cols-3 items-center px-6 py-4 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
              >
                <span className="font-medium text-slate-900">{a.label}</span>
                <code className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md w-fit">
                  {a.endpoint}
                </code>
                <span className="text-slate-600">{a.description}</span>
              </div>
            ))}
          </div>

          <div className="mt-20">
            <SectionHeader
              title="Searches"
              subtitle="Find eksisterende data i TimeTrack"
            />
          </div>
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Search</span>
              <span>Endpoint</span>
              <span>Beskrivelse</span>
            </div>
            {searches.map((s, i) => (
              <div
                key={s.label}
                className={`grid grid-cols-3 items-center px-6 py-4 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
              >
                <span className="font-medium text-slate-900">{s.label}</span>
                <code className="text-xs text-brand-700 bg-brand-50 px-2 py-1 rounded-md w-fit">
                  {s.endpoint}
                </code>
                <span className="text-slate-600">{s.description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="Sådan forbinder du"
            subtitle="3 trin, klar på under 2 minutter"
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Key className="mb-4 h-8 w-8 text-orange-500" />
              <h3 className="mb-2 font-semibold text-slate-900">
                1. Opret API nøgle
              </h3>
              <p className="text-sm text-slate-600">
                Gå til TimeTrack → Indstillinger → API Nøgler og opret en nøgle
                til Zapier.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Zap className="mb-4 h-8 w-8 text-orange-500" />
              <h3 className="mb-2 font-semibold text-slate-900">
                2. Forbind i Zapier
              </h3>
              <p className="text-sm text-slate-600">
                Indsæt API nøglen i Zapiers forbindelsesdialog. Base URL er{" "}
                <code className="text-xs">https://timetrack.dk</code>.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Webhook className="mb-4 h-8 w-8 text-orange-500" />
              <h3 className="mb-2 font-semibold text-slate-900">
                3. Byg din Zap
              </h3>
              <p className="text-sm text-slate-600">
                Vælg en trigger fra TimeTrack og forbind den til en action i en
                anden app.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Eksempel-Zaps"
            subtitle="Kom i gang med disse populære automationer"
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
                      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-600">
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
          "7 Zapier triggers",
          "Ingen kode krævet",
        ]}
      />

      <Footer />
    </>
  );
}
