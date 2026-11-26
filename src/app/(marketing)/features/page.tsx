import {
  AppWindow,
  ArrowRight,
  Bell,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  Code2,
  CreditCard,
  Download,
  FileText,
  Globe,
  Key,
  LayoutDashboard,
  Lock,
  Mail,
  Monitor,
  RefreshCw,
  Shield,
  Smartphone,
  Sparkles,
  Timer,
  Users,
  Webhook,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { QuickSignupForm } from "@/components/forms/QuickSignupForm";
import { AppScreenshot } from "@/components/marketing/AppScreenshot";
import { CTASection } from "@/components/marketing/CTASection";
import { FAQAccordion } from "@/components/marketing/FAQAccordion";
import { FeatureCard } from "@/components/marketing/FeatureCard";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { PillBadge } from "@/components/marketing/PillBadge";
import { RelatedLinks } from "@/components/marketing/RelatedLinks";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Funktioner: tidsregistrering, klippekort og AI",
  description:
    "TimeTrack samler tidstracking, klippekort, AI-opgavestyring, fakturering og kundeportal. Migrér fra Harvest, Toggl eller Clockify.",
  openGraph: {
    title: "Funktioner: tidsregistrering, klippekort og AI | TimeTrack",
    description:
      "TimeTrack samler tidstracking, klippekort, AI-opgavestyring, fakturering og kundeportal. Migrér fra Harvest, Toggl eller Clockify.",
  },
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvad er de vigtigste features at starte med?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Start med timeregistrering pr. kunde/projekt og en ugentlig rapport. Det giver typisk mest ro i faktureringen.",
        },
      },
      {
        "@type": "Question",
        name: "Har I klippekort/prepaid?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack understøtter klippekort/prepaid timer med saldo, historik og automatisk træk.",
        },
      },
      {
        "@type": "Question",
        name: "Kan jeg importere data fra Harvest, Toggl eller Clockify?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack har færdige importere til Harvest, Toggl, Clockify, TimeOps, Effihub, Trello og Todoist.",
        },
      },
      {
        "@type": "Question",
        name: "Hvad koster det?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Se siden Priser for aktuel prissætning.",
        },
      },
      {
        "@type": "Question",
        name: "Er der en browser extension?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja. TimeTrack har en Chrome- og Firefox-extension med timer, quick-log og et konfigurerbart new-tab dashboard.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvad er de vigtigste features at starte med?",
      answer: (
        <p>
          Start med timeregistrering pr. kunde/projekt og en ugentlig rapport.
          Det alene giver typisk mest ro i faktureringen.
        </p>
      ),
    },
    {
      question: "Har I klippekort/prepaid?",
      answer: (
        <p>
          Ja. Se{" "}
          <Link className="underline" href="/klippekort">
            klippekort
          </Link>{" "}
          eller{" "}
          <Link className="underline" href="/prepaid-timer">
            prepaid timer
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Kan jeg importere data fra Harvest, Toggl eller Clockify?",
      answer: (
        <p>
          Ja. TimeTrack har færdige importere til Harvest, Toggl, Clockify,
          TimeOps, Effihub, Trello og Todoist, tilgængelige under{" "}
          <strong>Integrationer → Import</strong> i dashboardet.
        </p>
      ),
    },
    {
      question: "Hvad koster det?",
      answer: (
        <p>
          Se{" "}
          <Link className="underline" href="/pricing">
            priser
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Er der en browser extension?",
      answer: (
        <p>
          Ja. Se{" "}
          <Link className="underline" href="/browser-extension">
            browser extension
          </Link>
          . Den er tilgængelig til Chrome og Firefox med timer, quick-log og
          new-tab dashboard.
        </p>
      ),
    },
  ];

  const relatedLinks = [
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Hvad det er, og hvordan du gør det let i praksis.",
    },
    {
      href: "/tidsregistrering",
      title: "Tidsregistrering",
      description: "Samme disciplin, men med fokus på dokumentation.",
    },
    {
      href: "/timeregistrering-app",
      title: "Timeregistrering app",
      description: "Når tracking skal være hurtigt nok til at blive gjort.",
    },
    {
      href: "/timeregistrering-til-faktura",
      title: "Timeregistrering til faktura",
      description: "Gør timer til et fakturagrundlag med få klik.",
    },
    {
      href: "/faktura-ud-fra-timer",
      title: "Faktura ud fra timer",
      description: "Specifikation pr. kunde/projekt og periode.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Prepaid timer med saldo og overblik.",
    },
    {
      href: "/prepaid-timer",
      title: "Prepaid timer",
      description: "Sælg timer på forhånd uden at miste styring.",
    },
    {
      href: "/billy",
      title: "Billy",
      description: "Eksport/flow der passer til Billy-brugere.",
    },
    {
      href: "/dinero",
      title: "Dinero",
      description: "Eksport/flow der passer til Dinero-brugere.",
    },
    {
      href: "/fakturagrundlag",
      title: "Fakturagrundlag",
      description: "Tydelig specifikation så fakturering glider.",
    },
    {
      href: "/timerapport",
      title: "Timerapport",
      description: "Rapport over timer pr. periode.",
    },
    {
      href: "/timeforbrug",
      title: "Timeforbrug",
      description: "Overblik over hvor tiden går pr. kunde.",
    },
  ];

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navigation />

      {/* Hero */}
      <MarketingHero
        badge={
          <PillBadge icon={<Sparkles className="h-4 w-4" />} variant="purple">
            Alt hvad du behøver
          </PillBadge>
        }
        title="Funktioner"
        subtitle="TimeTrack er bygget til solo-freelancere og små teams: registrér tid, håndter klippekort, sortér opgaver og fakturér med ro i maven."
      >
        <div className="mx-auto flex max-w-md flex-col gap-3">
          <Link
            href="/#get-started"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg"
          >
            Start gratis
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-8 py-4 font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            Se priser
          </Link>
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Gratis at starte, intet betalingskort.
        </p>
      </MarketingHero>

      {/* Main features sections */}
      <div className="border-t border-slate-200/60 bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-20">
          {/* 1. Tidsregistrering & timere */}
          <section>
            <SectionHeader
              title="Tidsregistrering & timere"
              subtitle="Fra stopur til faktura i ét flow."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Timer className="h-6 w-6" />}
                title="Stopur & manuel oprettelse"
                description="Start/stop timer direkte fra opgaver og projekter. Tilføj timer manuelt med dato, fra/til og beskrivelse."
              />
              <FeatureCard
                icon={<Clock className="h-6 w-6" />}
                title="Timer pr. kunde & projekt"
                description="Grupperet visning af timer fordelt på kunder og projekter. Filtrer på dato, status og periode."
              />
              <FeatureCard
                icon={<FileText className="h-6 w-6" />}
                title="Uge- & månedsoverblik"
                description="Automatisk sammenfatning af timer i kalenderperioder. Eksportér som CSV eller PDF til dit fakturagrundlag."
              />
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="Tilbagevendende templates"
                description="Opret regel-baserede tidsposter der gentages automatisk, fx fast månedlig vedligeholdelse."
              />
              <FeatureCard
                icon={<Zap className="h-6 w-6" />}
                title="Automatisk afrunding"
                description="Afrund timer til 5, 10, 15, 30 eller 60 minutter. Tre-lags hierarki: projekt → kunde → global."
              />
              <FeatureCard
                icon={<CreditCard className="h-6 w-6" />}
                title="Rate-hierarki & historik"
                description="Projekt-sats → kunde-sats → global sats. Fuld historik over alle satsændringer."
              />
            </div>
          </section>

          {/* 2. Klippekort & fakturering */}
          <section>
            <SectionHeader
              title="Klippekort & fakturering"
              subtitle="Det der adskiller TimeTrack fra alle andre: prepaid timer med fuld kontrol."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Zap className="h-6 w-6" />}
                title="Klippekort / prepaid"
                description="Sælg timer på forhånd og lad systemet holde styr på forbrug og saldo. Realtids-visning af resterende timer."
                links={[
                  { href: "/klippekort", label: "Klippekort" },
                  { href: "/prepaid-timer", label: "Prepaid timer" },
                ]}
              />
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="Automatisk & manuelt klip"
                description="Timer trækkes automatisk fra klippekort ved tidsregistrering. Manuel klip-funktion til andre justeringer."
              />
              <FeatureCard
                icon={<Bell className="h-6 w-6" />}
                title="Udløbsvarslinger"
                description="Automatisk markering af udløbende og udløbne pakker med notifikationer til dig og din kunde."
              />
              <FeatureCard
                icon={<FileText className="h-6 w-6" />}
                title="PDF-fakturaer med branding"
                description="Generer fakturaer automatisk fra timer eller klippekort. Draft → Sendt → Betalt workflow med PDF og email."
              />
              <FeatureCard
                icon={<Calendar className="h-6 w-6" />}
                title="Faste aftaler og gentagne fakturaer"
                description="Opret en fast aftale pr. kunde, hver måned, hvert kvartal eller hvert år. TimeTrack genererer kladden automatisk, med faste linjer eller den registrerede tid, og kan koble den til et klippekort. Billy eller Dinero, når du selv vil."
              />
              <FeatureCard
                icon={<CreditCard className="h-6 w-6" />}
                title="Fakturering af klippekort-rest"
                description="Fakturer ikke-forbrugte timer på udløbne klippekort, valgfrit pr. kunde."
              />
              <FeatureCard
                icon={<FileText className="h-6 w-6" />}
                title="Klippekort-historik"
                description="Fuld log over alle klip med dato, beskrivelse og resterende saldo. Del med kunden via kundeportalen."
              />
            </div>

            {/* Screenshot */}
            <div className="mt-10">
              <div className="mx-auto max-w-4xl">
                <AppScreenshot
                  src="/screenshots/dashboard/desktop-reports.png"
                  alt="TimeTrack rapporter: overblik over timer pr. kunde og periode"
                />
              </div>
            </div>
          </section>

          {/* 3. AI & automatisering */}
          <section>
            <div className="mb-10 rounded-2xl border border-brand-200/60 bg-brand-50 p-8">
              <div className="mb-2 flex items-center gap-2">
                <Brain className="h-6 w-6 text-brand-600" />
                <span className="text-sm font-semibold uppercase tracking-wide text-brand-600">
                  Differentiator
                </span>
              </div>
              <h2 className="text-3xl font-bold text-slate-900">
                AI & automatisering
              </h2>
              <p className="mt-2 text-lg text-slate-600">
                AI hjælper med sortering, prioritering og email-parsing, og du
                beholder fuld kontrol over dine data.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Mail className="h-6 w-6" />}
                title="AI email-to-task"
                description="Du får en unik emailadresse (task+{id}@timetrack.dk). Send en email, så parser AI automatisk titel, beskrivelse, deadline og projekt."
              />
              <FeatureCard
                icon={<Brain className="h-6 w-6" />}
                title="AI prioritering & kategorisering"
                description="Daglige AI-forslag til dine top 3 vigtigste opgaver. Auto-matching til projekter og kunder baseret på indhold og historik."
              />
              <FeatureCard
                icon={<Key className="h-6 w-6" />}
                title="BYOK: Bring Your Own Key"
                description="Brug din egen OpenAI- eller Azure OpenAI-nøgle. Understøtter også self-hosted LLMs: Ollama, LocalAI og andre OpenAI-kompatible endpoints. Dine data forlader ikke din provider."
              />
              <FeatureCard
                icon={<Sparkles className="h-6 w-6" />}
                title="AI autonomi-niveauer"
                description="Vælg din komfortzone: Foreslå (du godkender alt), Auto (AI klarer simple opgaver), eller Manuel (ingen AI)."
              />
              <FeatureCard
                icon={<Bell className="h-6 w-6" />}
                title="Automatiske påmindelser"
                description="Cron-baserede reminders om deadlines, lav klippekort-saldo, manglende timeregistrering og ubillede timer."
              />
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="Outgoing webhooks"
                description="Send events til Zapier, Make, N8n eller dine egne systemer. Retry-logic ved fejl."
              />
            </div>
          </section>

          {/* 4. Dashboard */}
          <section>
            <SectionHeader
              title="Dashboard med 14 widgets"
              subtitle="Drag-and-drop konfiguration. Se præcis det, du har brug for."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                "Ufaktureret tid",
                "Omsætning pr. kunde",
                "Daglig tidsfordeling",
                "Ugentligt mål-tracker",
                "Projekt-sundhed",
                "Klippekort status",
                "Udløbende pakker",
                "Pending approvals",
                "Afrunding-bonus",
                "Aktiv timer",
                "Ugentlig rapport",
                "Opgave-overblik",
                "Kanban-hurtigvisning",
                "Kalender-events",
              ].map((widget) => (
                <div
                  key={widget}
                  className="flex items-center gap-3 rounded-xl border border-slate-200/60 bg-white px-4 py-3 shadow-sm"
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0 text-brand-500" />
                  <span className="text-sm font-medium text-slate-700">
                    {widget}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 5. Opgavestyring */}
          <section>
            <SectionHeader
              title="Opgavestyring"
              subtitle="Fra simpel to-do til Kanban, integreret med timeren."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<LayoutDashboard className="h-6 w-6" />}
                title="Kanban-visning"
                description="Drag-and-drop Kanban-board med statusser: Åben, I gang, Afsluttet. Filtrer pr. projekt eller kunde."
              />
              <FeatureCard
                icon={<Timer className="h-6 w-6" />}
                title="Opgave-stopur integration"
                description="Start timer direkte fra en opgave. Timen tilknyttes automatisk til det rigtige projekt og den rigtige kunde."
              />
              <FeatureCard
                icon={<Bell className="h-6 w-6" />}
                title="Deadline-varsling"
                description="Visuel indikation af kommende og overskredte deadlines. Automatiske email-påmindelser."
              />
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="Tilbagevendende opgaver"
                description="Opret opgaver der gentages dagligt, ugentligt eller månedligt via templates."
              />
              <FeatureCard
                icon={<Mail className="h-6 w-6" />}
                title="Email-to-task"
                description="Send en email til din personlige task-adresse og opgaven oprettes automatisk, med AI-parsing af indhold og prioritet."
              />
              <FeatureCard
                icon={<Brain className="h-6 w-6" />}
                title="AI tidsestimering"
                description="AI foreslår et tidsestimat baseret på opgavebeskrivelse og din historik."
              />
            </div>
          </section>

          {/* 6. Kundestyring & portal */}
          <section>
            <SectionHeader
              title="Kundestyring & kundeportal"
              subtitle="Giv dine kunder transparens og dig selv struktur."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Users className="h-6 w-6" />}
                title="Kunder & projekter"
                description="CRUD med arkivering, CVR-opslag, kundespecifikke satser, budget-tracking og projektstatus."
              />
              <FeatureCard
                icon={<Globe className="h-6 w-6" />}
                title="White-label kundeportal"
                description="Kunder logger ind og ser egne timer, klippekort-saldo og fakturaer. Tilpas med dit logo og dine farver."
              />
              <FeatureCard
                icon={<FileText className="h-6 w-6" />}
                title="Approval-flow"
                description="Kunder kan godkende tidsregistreringer direkte i portalen. Pending approvals vises som widget i dit dashboard."
              />
              <FeatureCard
                icon={<Bell className="h-6 w-6" />}
                title="Kunde-notifikationer"
                description="Automatiske emails til kunden ved nye fakturaer, lav klippekort-saldo og projektmilepæle."
              />
              <FeatureCard
                icon={<Briefcase className="h-6 w-6" />}
                title="CVR-opslag"
                description="Udfyld virksomhedsdata automatisk ved at indtaste CVR-nummer via den offentlige CVR API."
              />
              <FeatureCard
                icon={<FileText className="h-6 w-6" />}
                title="Projektbudget & sundhed"
                description="Sæt et timebudget og se forbrug i realtid. Projekt-sundhed vises som widget og i rapporter."
              />
            </div>
          </section>

          {/* 7. Team & enterprise */}
          <section>
            <SectionHeader
              title="Team & enterprise"
              subtitle="Skalér fra solo til lille team uden at skifte system."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Building2 className="h-6 w-6" />}
                title="Multi-user organisationer"
                description="Tilføj teammedlemmer med roller: Admin, Projektleder og Medarbejder, med forskellige adgangsniveauer."
              />
              <FeatureCard
                icon={<FileText className="h-6 w-6" />}
                title="Approval-flow for timer"
                description="Medarbejdere registrerer tid, og du godkender. Fuld historik over hvem der har godkendt hvad."
              />
              <FeatureCard
                icon={<Calendar className="h-6 w-6" />}
                title="Flex- og feriesaldo"
                description="Spor flex-tid og feriedage pr. medarbejder. Holiday management integreret i platformen."
              />
              <FeatureCard
                icon={<Lock className="h-6 w-6" />}
                title="Audit log"
                description="Detaljeret log over alle systemændringer: hvem der har gjort hvad og hvornår."
              />
              <FeatureCard
                icon={<Bell className="h-6 w-6" />}
                title="Notifikationskanaler"
                description="Email, Discord, Slack, push-notifikationer og SMS. Konfigurér pr. event-type."
              />
              <FeatureCard
                icon={<Globe className="h-6 w-6" />}
                title="Dansk & engelsk UI"
                description="Fuld i18n-support. Skift sprog pr. bruger, så tilpasser systemet sig."
              />
            </div>
          </section>

          {/* 8. Integrationer */}
          <section>
            <SectionHeader
              title="Integrationer"
              subtitle="Forbind TimeTrack til dit regnskabssystem, din kalender og dine automationsværktøjer."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="Billy"
                description="Synkronisér kunder, projekter og fakturaer direkte med Billy.dk."
                links={[{ href: "/billy", label: "Se Billy-integration" }]}
              />
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="Dinero"
                description="Live OAuth-integration med Dinero. Importér kunder, eksportér fakturaer direkte."
                links={[{ href: "/dinero", label: "Se Dinero-integration" }]}
              />
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="e-conomic"
                description="ERP-integration med e-conomic."
              />
              <FeatureCard
                icon={<Calendar className="h-6 w-6" />}
                title="Google Calendar"
                description="OAuth-sync med Google Calendar. Opret automatisk tidsposter fra kalenderbegivenheder."
              />
              <FeatureCard
                icon={<Webhook className="h-6 w-6" />}
                title="Zapier, Make & N8n"
                description="Offentligt tilgængelige webhook-endepunkter. Forbind TimeTrack til hundredvis af andre apps via automationsplatforme."
              />
              <FeatureCard
                icon={<Mail className="h-6 w-6" />}
                title="Resend til transaktionel email"
                description="Alle systememails (fakturaer, påmindelser, onboarding) sendes via Resend med din egen afsenderadresse."
              />
            </div>
          </section>

          {/* 9. Platform & udvikler */}
          <section>
            <SectionHeader
              title="Platform & udvikler"
              subtitle="Apps til iPhone, Mac og Windows, browserudvidelse, API og webhooks."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Smartphone className="h-6 w-6" />}
                title="App til iPhone og iPad"
                description="Start og stop timeren, og skriv tid ind for tidligere dage. Appen ligger i App Store, og Android-appen kommer snart i Google Play."
                links={[{ href: "/download", label: "Hent appen" }]}
              />
              <FeatureCard
                icon={<Monitor className="h-6 w-6" />}
                title="Desktop-app til Mac og Windows"
                description="Timeren tæt på, også når browseren er lukket. Desktop-appen kan registrere, hvilke programmer du arbejder i, og aktiviteten bliver på din computer."
                links={[{ href: "/desktop", label: "Se desktop-appen" }]}
              />
              <FeatureCard
                icon={<Globe className="h-6 w-6" />}
                title="Webapp, der kan installeres"
                description="Læg TimeTrack på telefonens hjemmeskærm eller som app på computeren. Virker også uden netforbindelse og synkroniserer, når du er online igen."
              />
              <FeatureCard
                icon={<AppWindow className="h-6 w-6" />}
                title="Browser extension"
                description="Chrome og Firefox. Track tid hvor arbejdet sker: timer, quick-log, project auto-detection og new-tab dashboard med 14 widgets."
                links={[{ href: "/browser-extension", label: "Se extension" }]}
              />
              <FeatureCard
                icon={<Code2 className="h-6 w-6" />}
                title="Public REST API + OpenAPI"
                description="Fuld REST API på /api/v1/* med OpenAPI-spec. Byg dine egne integrationer eller automatiseringer."
              />
              <FeatureCard
                icon={<Webhook className="h-6 w-6" />}
                title="Outgoing webhooks"
                description="Få events pushed til dine egne endpoints ved timer-oprettelse, fakturering, klippekort-hændelser m.m. Automatisk retry ved fejl."
              />
              <FeatureCard
                icon={<RefreshCw className="h-6 w-6" />}
                title="Automatiserede baggrundsjobs"
                description="Mere end 20 cron-jobs kører automatisk: påmindelser, kalender-sync, webhook-retry, månedsoversigter og AI-forslag."
              />
              <FeatureCard
                icon={<Globe className="h-6 w-6" />}
                title="Cookieløs analytics"
                description="Plausible Analytics: GDPR-compliant, ingen cookies, ingen tracking af brugerne."
              />
            </div>
          </section>

          {/* 10. Migrering */}
          <section>
            <div className="mb-10 rounded-2xl border border-emerald-200/60 bg-emerald-50 p-8">
              <div className="mb-2 flex items-center gap-2">
                <Download className="h-6 w-6 text-emerald-600" />
                <span className="text-sm font-semibold uppercase tracking-wide text-emerald-600">
                  Skift uden besvær
                </span>
              </div>
              <h2 className="text-3xl font-bold text-slate-900">
                Migrering fra konkurrenter
              </h2>
              <p className="mt-2 text-lg text-slate-600">
                Tag dine data med. TimeTrack har færdige importere til de mest
                populære systemer til tidsregistrering. Importen tager få
                minutter.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  name: "Harvest",
                  desc: "Importer kunder, projekter og tidsregistreringer fra Harvest.",
                },
                {
                  name: "Toggl",
                  desc: "Importer din fulde Toggl-historik inkl. kunder og projekter.",
                },
                {
                  name: "Clockify",
                  desc: "Importer fra Clockify: kunder, projekter og tidsregistreringer.",
                },
                {
                  name: "TimeOps",
                  desc: "Skift fra TimeOps og bevar al din data.",
                },
                {
                  name: "Effihub",
                  desc: "Importer fra Effihub med fuld projektstruktur.",
                },
                {
                  name: "Trello",
                  desc: "Konvertér Trello-boards til TimeTrack-projekter og opgaver.",
                },
                {
                  name: "Todoist",
                  desc: "Importer Todoist-opgaver direkte til TimeTrack-opgavestyring.",
                },
              ].map((tool) => (
                <div
                  key={tool.name}
                  className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm transition hover:shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                      <ArrowRight className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">
                        {tool.name}
                      </p>
                      <p className="text-sm text-slate-500">{tool.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-slate-500">
              Importerne findes under{" "}
              <strong>Dashboard → Integrationer → Import</strong> efter
              oprettelse.
            </p>
          </section>

          {/* 11. Sikkerhed & privatliv */}
          <section>
            <SectionHeader
              title="Sikkerhed & privatliv"
              subtitle="Du ejer dine data. Vi beskytter dem."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={<Shield className="h-6 w-6" />}
                title="2FA, passkeys & magic link"
                description="Tofaktor-godkendelse, passkeys (WebAuthn), magic link og OAuth via Google, GitHub og Discord."
              />
              <FeatureCard
                icon={<Lock className="h-6 w-6" />}
                title="GDPR-dataværktøjer"
                description="Eksportér, anonymisér eller slet dine data. Fuld compliance med GDPR uden besvær."
              />
              <FeatureCard
                icon={<FileText className="h-6 w-6" />}
                title="Audit log"
                description="Komplet log over alle systemhandlinger med tidsstempler og brugertilskrivning."
              />
              <FeatureCard
                icon={<Lock className="h-6 w-6" />}
                title="Session-styring"
                description="Se og afslut aktive sessions på tværs af enheder. Automatisk udløb af inaktive sessions."
              />
              <FeatureCard
                icon={<Globe className="h-6 w-6" />}
                title="Cookieløs analytics"
                description="Plausible Analytics: du trackes ikke af analyseværktøjet."
              />
              <FeatureCard
                icon={<Key className="h-6 w-6" />}
                title="BYOK datakontrol"
                description="Med Bring Your Own Key sendes AI-kald direkte til din egen provider. Ingen data går igennem vores servere."
              />
            </div>
          </section>

          {/* Populære sider */}
          <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <RelatedLinks
              title="Populære sider"
              subtitle="Hvis du leder efter noget specifikt, så hop direkte ind her:"
              links={relatedLinks}
            />
          </div>

          {/* Kom i gang */}
          <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-8">
            <h3 className="text-2xl font-bold text-slate-900">Kom i gang</h3>
            <p className="mt-2 text-slate-600">
              Opret en kunde, track tid en uge, og brug rapporten som dit
              fakturagrundlag.
            </p>
            <div className="mt-6 max-w-md">
              <QuickSignupForm variant="hero" />
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Har du spørgsmål? Se{" "}
              <Link className="underline" href="/faq">
                FAQ
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <section className="border-t border-slate-200/60 bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <FAQAccordion title="Ofte stillede spørgsmål" items={faqItems} />
        </div>
      </section>

      {/* CTA */}
      <CTASection
        variant="gradient"
        title="Klar til at komme i gang?"
        subtitle="Start gratis med TimeTrack, intet betalingskort."
        primaryHref="/#get-started"
        primaryLabel="Start gratis"
        secondaryHref="/pricing"
        secondaryLabel="Se priser"
        checkmarks={[
          "Gratis at starte",
          "Intet betalingskort",
          "Annuller når som helst",
        ]}
      />

      <Footer />
    </div>
  );
}
