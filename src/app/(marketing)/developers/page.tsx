import {
  ArrowRight,
  BookOpen,
  Bot,
  Clock,
  Code2,
  FileText,
  Key,
  Lock,
  Receipt,
  Sparkles,
  Terminal,
  Ticket,
  Users,
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
  title: "API til udviklere",
  description:
    "Integrer TimeTrack i dine egne værktøjer med det åbne REST API. Fuld adgang til kunder, projekter, tidsregistrering, fakturaer, klippekort og opgaver.",
  alternates: { canonical: "/developers" },
};

const resources = [
  {
    icon: Users,
    name: "Kunder",
    description: "Opret, hent og opdater kunder med kontaktinfo og CVR",
    endpoint: "/api/v1/clients",
  },
  {
    icon: Code2,
    name: "Projekter",
    description: "Administrer projekter med timesatser og kundekobling",
    endpoint: "/api/v1/projects",
  },
  {
    icon: Clock,
    name: "Tidsregistrering",
    description: "Log timer, hent rapporter og integrer med din egen workflow",
    endpoint: "/api/v1/time-entries",
  },
  {
    icon: Receipt,
    name: "Fakturaer",
    description: "Opret, send og marker fakturaer som betalt",
    endpoint: "/api/v1/invoices",
  },
  {
    icon: Ticket,
    name: "Klippekort",
    description: "Håndter prepaid-pakker med saldo og forbrug",
    endpoint: "/api/v1/prepaid-packages",
  },
  {
    icon: FileText,
    name: "Opgaver",
    description: "Kanban-opgaver med status, prioritet og deadlines",
    endpoint: "/api/v1/tasks",
  },
];

export default function DevelopersPage() {
  return (
    <>
      <Navigation />

      {/* Hero */}
      <MarketingHero
        badge={<PillBadge>REST API v1</PillBadge>}
        title={
          <>
            Byg videre på <span className="text-brand-600">TimeTrack</span>
          </>
        }
        subtitle="Et åbent REST API der giver dig fuld adgang til dine data. Integrer TimeTrack i dine egne værktøjer, automationer og workflows."
      >
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/api/v1/docs"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-8 py-4 font-semibold text-white transition-all hover:bg-emerald-700 hover:shadow-lg"
          >
            <BookOpen className="h-5 w-5" />
            Interaktiv dokumentation
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-8 py-4 font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            Opret konto
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </MarketingHero>

      {/* Resources Grid */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="6 resources, fuld CRUD"
            subtitle="Alt du har i TimeTrack er tilgængeligt via API'et"
          />

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((resource) => (
              <div
                key={resource.name}
                className="group rounded-2xl border border-slate-200/60 bg-white p-6 transition-all hover:border-emerald-200 hover:shadow-md"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 transition-colors group-hover:bg-emerald-100">
                  <resource.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-slate-900">
                  {resource.name}
                </h3>
                <p className="mb-4 text-sm text-slate-600">
                  {resource.description}
                </p>
                <code className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">
                  {resource.endpoint}
                </code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Auth & Features */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            title="Bygget til udviklere"
            subtitle="Simpel auth, præcise scopes og klar dokumentation"
          />

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-8">
              <Key className="mb-4 h-8 w-8 text-emerald-600" />
              <h3 className="mb-3 text-lg font-semibold text-slate-900">
                API Keys
              </h3>
              <p className="text-sm text-slate-600">
                Opret nøgler direkte i dit dashboard med valgfrie scopes. Nøgler
                er SHA-256 hashed og kan revokes når som helst.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-8">
              <Lock className="mb-4 h-8 w-8 text-emerald-600" />
              <h3 className="mb-3 text-lg font-semibold text-slate-900">
                Scoped permissions
              </h3>
              <p className="text-sm text-slate-600">
                Giv hver nøgle præcis de rettigheder den har brug for. Vælg
                read, write eller fuld adgang per resource.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-8">
              <Zap className="mb-4 h-8 w-8 text-emerald-600" />
              <h3 className="mb-3 text-lg font-semibold text-slate-900">
                100 req/min
              </h3>
              <p className="text-sm text-slate-600">
                Generøs rate limit med headers på alle responses så du altid ved
                hvor meget kapacitet du har tilbage.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="Kom i gang på 2 minutter"
            subtitle="Standard REST med JSON. Brug dit foretrukne sprog."
          />

          <div className="mt-12 space-y-6">
            {/* curl example */}
            <div className="rounded-2xl border border-slate-200/60 bg-slate-900 p-6 shadow-lg">
              <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
                <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                <span className="inline-block h-3 w-3 rounded-full bg-yellow-500" />
                <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                <span className="ml-2">Hent dine kunder</span>
              </div>
              <pre className="overflow-x-auto text-sm leading-relaxed">
                <code className="text-green-400">
                  {`curl -H "Authorization: Bearer tk_live_din_nøgle..." \\
  https://timetrack.dk/api/v1/clients`}
                </code>
              </pre>
            </div>

            {/* JS example */}
            <div className="rounded-2xl border border-slate-200/60 bg-slate-900 p-6 shadow-lg">
              <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
                <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                <span className="inline-block h-3 w-3 rounded-full bg-yellow-500" />
                <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                <span className="ml-2">
                  Opret en tidsregistrering (JavaScript)
                </span>
              </div>
              <pre className="overflow-x-auto text-sm leading-relaxed">
                <code className="text-green-400">
                  {`const response = await fetch("https://timetrack.dk/api/v1/time-entries", {
  method: "POST",
  headers: {
    "Authorization": "Bearer tk_live_din_nøgle...",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    projectId: "projekt-id",
    date: "2026-03-27",
    hours: 2.5,
    description: "API integration",
  }),
});

const { data } = await response.json();`}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* AI Agents */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <SectionHeader
            title="Brug TimeTrack med AI-agenter"
            subtitle="Lad Claude, Codex eller din egen agent registrere tid og hente rapporter via det åbne agent-skill"
          />

          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Bot className="mb-4 h-8 w-8 text-emerald-600" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Claude Code
              </h3>
              <p className="text-sm text-slate-600">
                Klon skillet ind i{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-emerald-700">
                  ~/.claude/skills
                </code>
                . Det aktiveres automatisk på "registrer tid".
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Terminal className="mb-4 h-8 w-8 text-emerald-600" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Codex
              </h3>
              <p className="text-sm text-slate-600">
                Læg det i{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-emerald-700">
                  ~/.agents/skills
                </code>
                . Samme skill, samme arbejdsgang.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <Sparkles className="mb-4 h-8 w-8 text-emerald-600" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Andre agenter
              </h3>
              <p className="text-sm text-slate-600">
                Kernen er rene HTTP-kald, så enhver agent der kan køre shell
                eller HTTP kan bruge det.
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200/60 bg-slate-900 p-6 shadow-lg">
            <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
              <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
              <span className="inline-block h-3 w-3 rounded-full bg-yellow-500" />
              <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
              <span className="ml-2">Installér på 30 sekunder</span>
            </div>
            <pre className="overflow-x-auto text-sm leading-relaxed">
              <code className="text-green-400">
                {`git clone https://github.com/mahope/timetrack-skill ~/.claude/skills/timetrack
echo "TIMETRACK_API_KEY=tk_live_din_nøgle..." > ~/.timetrack-secret`}
              </code>
            </pre>
          </div>

          <div className="mt-10 text-center">
            <Link
              href="https://github.com/mahope/timetrack-skill"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-8 py-4 font-semibold text-white transition-all hover:bg-emerald-700 hover:shadow-lg"
            >
              <Bot className="h-5 w-5" />
              Hent agent-skillet på GitHub
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <CTASection
        title="Klar til at integrere?"
        subtitle="Opret en gratis konto og generer din første API nøgle på under et minut."
        primaryHref="/register"
        primaryLabel="Opret konto"
        secondaryHref="/api/v1/docs"
        secondaryLabel="Se dokumentation"
        checkmarks={[
          "Gratis API adgang",
          "Interaktiv dokumentation",
          "100 requests/minut",
        ]}
      />

      <Footer />
    </>
  );
}
