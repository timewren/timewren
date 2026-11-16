import { ArrowLeft, BookOpen, Key, Webhook, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { CTASection } from "@/components/marketing/CTASection";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { PillBadge } from "@/components/marketing/PillBadge";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Make-integration: TimeTrack",
  description:
    "Forbind TimeTrack med Make (tidligere Integromat). 7 watch-triggere, 5 actions og 2 searches i et visuelt workflow-interface.",
  alternates: { canonical: "/integrations/make" },
};

const watchTriggers = [
  {
    label: "Watch New Time Entries",
    event: "time_entry.created",
    description: "Ny tidsregistrering oprettet",
  },
  {
    label: "Watch Time Entry Updated",
    event: "time_entry.updated",
    description: "Tidsregistrering opdateret",
  },
  {
    label: "Watch New Clients",
    event: "client.created",
    description: "Ny kunde oprettet",
  },
  {
    label: "Watch New Invoices",
    event: "invoice.created",
    description: "Ny faktura oprettet",
  },
  {
    label: "Watch Invoice Paid",
    event: "invoice.paid",
    description: "Faktura markeret som betalt",
  },
  {
    label: "Watch Prepaid Low Balance",
    event: "prepaid.low_balance",
    description: "Klippekort under minimumsgrænse",
  },
  {
    label: "Watch Task Completed",
    event: "task.completed",
    description: "Opgave fuldført",
  },
];

const actions = [
  {
    label: "Create Time Entry",
    endpoint: "POST /api/v1/time-entries",
    fields: "projectId*, description*, date*, durationMinutes*, isBillable",
  },
  {
    label: "Create Client",
    endpoint: "POST /api/v1/clients",
    fields: "name*, email, phone, company, cvrNumber",
  },
  {
    label: "Create Task",
    endpoint: "POST /api/v1/tasks",
    fields: "projectId*, title*, description, status, priority",
  },
  {
    label: "Start Timer",
    endpoint: "POST /api/v1/timer",
    fields: "projectId, clientId, description",
  },
  {
    label: "Stop Timer",
    endpoint: "DELETE /api/v1/timer",
    fields: "–",
  },
];

const searches = [
  {
    label: "Find Client",
    endpoint: "GET /api/v1/clients?q=",
    description: "Søg på navn eller e-mail",
  },
  {
    label: "Find Project",
    endpoint: "GET /api/v1/projects?clientId=",
    description: "Hent projekter for en kunde",
  },
];

const useCases = [
  {
    title: "Daglig timerapport til e-mail",
    steps: [
      "Schedule → Kører kl. 17:00 hver hverdag",
      "HTTP Request → GET /api/v1/reports/time-summary?from={{today}}&to={{today}}",
      "Email → Send opsummering til dig selv",
    ],
  },
  {
    title: "Ny kunde → HubSpot/Pipedrive",
    steps: [
      "Watch New Clients (TimeTrack)",
      "Create Contact (HubSpot eller Pipedrive) → Opret kontakt med kundens data",
    ],
  },
  {
    title: "Faktura betalt → Bogføring",
    steps: [
      "Watch Invoice Paid (TimeTrack)",
      "Create Entry (Billy / Dinero / Google Sheets) → Bogfør betalingen",
    ],
  },
  {
    title: "GitHub issue lukket → TimeTrack opgave",
    steps: [
      "Watch Issues (GitHub) → Issue lukket",
      "Find Project (TimeTrack) → Slå projektet op",
      "Create Task (TimeTrack) → Opret afsluttet opgave",
    ],
  },
];

export default function MakeIntegrationPage() {
  return (
    <>
      <Navigation />

      <MarketingHero
        badge={<PillBadge>Make</PillBadge>}
        title={
          <>
            TimeTrack + <span className="text-purple-700">Make</span>
          </>
        }
        subtitle="Byg visuelle automationsscenarier der forbinder TimeTrack med hundredvis af apps. Drag-and-drop interface med fuld webhook-support."
      >
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard/settings/integrations"
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-8 py-4 font-semibold text-white transition-all hover:bg-purple-700 hover:shadow-lg"
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

      {/* Watch triggers */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Watch-triggere"
            subtitle="Webhook-baserede: Make abonnerer og afmelder automatisk"
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Modul</span>
              <span>Event</span>
              <span>Beskrivelse</span>
            </div>
            {watchTriggers.map((t, i) => (
              <div
                key={t.event}
                className={`grid grid-cols-3 items-center px-6 py-4 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
              >
                <span className="font-medium text-slate-900">{t.label}</span>
                <code className="text-xs text-purple-700 bg-purple-50 px-2 py-1 rounded-md w-fit">
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
            subtitle="Opret og opdater data i TimeTrack"
          />
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Modul</span>
              <span>Endpoint</span>
              <span>Felter (* = påkrævet)</span>
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
                <span className="text-xs text-slate-500">{a.fields}</span>
              </div>
            ))}
          </div>

          <div className="mt-20">
            <SectionHeader
              title="Searches"
              subtitle="Slå eksisterende data op"
            />
          </div>
          <div className="mt-12 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Modul</span>
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
            title="Sådan opsætter du Make"
            subtitle="Installer Custom App og opret forbindelsen"
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Key className="mb-4 h-8 w-8 text-purple-600" />
              <h3 className="mb-2 font-semibold text-slate-900">
                1. Opret API nøgle
              </h3>
              <p className="text-sm text-slate-600">
                Gå til TimeTrack → Indstillinger → API Nøgler og opret en nøgle
                til Make.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Workflow className="mb-4 h-8 w-8 text-purple-600" />
              <h3 className="mb-2 font-semibold text-slate-900">
                2. Installer Custom App
              </h3>
              <p className="text-sm text-slate-600">
                Gå til Make → Custom Apps → Create og importér modules.json fra
                TimeTrack repositoriet.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Webhook className="mb-4 h-8 w-8 text-purple-600" />
              <h3 className="mb-2 font-semibold text-slate-900">
                3. Byg dit scenarie
              </h3>
              <p className="text-sm text-slate-600">
                Vælg et Watch-modul som trigger og forbind det til en action i
                en anden app.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Eksempel-scenarier"
            subtitle="Inspiration til dine første Make-workflows med TimeTrack"
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
                      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-600">
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
          "7 Make-moduler",
          "Visuelle workflows",
        ]}
      />

      <Footer />
    </>
  );
}
