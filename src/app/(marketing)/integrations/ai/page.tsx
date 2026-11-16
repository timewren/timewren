import {
  Bot,
  KeyRound,
  MessageSquare,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

// Kanonisk side for AI-assistenter og MCP (#701). /ai redirecter hertil
// (next.config.ts), så der kun er én side om emnet.
const TITLE = "Brug din AI-assistent med TimeTrack";
const DESCRIPTION =
  "Registrér tid, lav fakturakladder og slå ufakturerede timer op fra din AI-assistent via TimeTracks MCP-server og REST API. Se hvilke assistenter der virker i dag.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE}: MCP og API | TimeTrack` },
  description: DESCRIPTION,
  alternates: { canonical: "/integrations/ai" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/integrations/ai",
    type: "website",
    images: [
      {
        url: "/api/og?badge=MCP%20og%20API&title=Brug%20din%20AI-assistent%20med%20TimeTrack&subtitle=Registr%C3%A9r%20tid%20og%20lav%20fakturakladder%20fra%20din%20assistent",
        width: 1200,
        height: 630,
      },
    ],
  },
};

const MCP_URL = "https://app.timetrack.dk/api/v1/mcp";

// Hvert eksempel svarer til et værktøj, der findes i dag.
const EXAMPLES = [
  {
    title: "Registrér tid",
    prompt: "Registrér 2 timer på Novafilm i går: design af kampagnesite.",
    how: "Assistenten opretter tidsposten på kunden. Timeprisen følger dine satser for kunde og projekt.",
    via: "MCP",
  },
  {
    title: "Opret en faktura",
    prompt:
      "Lav en fakturakladde af de ufakturerede timer på Novafilm i september.",
    how: "Der laves en kladde ud fra tidsposterne, som du kan se igennem i TimeTrack, før den sendes.",
    via: "MCP",
  },
  {
    title: "Find ufaktureret tid",
    prompt: "Hvor mange ufakturerede timer har jeg på tværs af kunder lige nu?",
    how: "Du får timer og beløb pr. kunde, så du kan se, hvor der ligger penge.",
    via: "MCP",
  },
  {
    title: "Tjek klippekortets saldo",
    prompt: "Hvor mange timer er der tilbage på Novafilms klippekort?",
    how: "Du får brugte og resterende timer pr. klippekort, så du kan se, om kunden snart skal have et nyt.",
    via: "MCP",
  },
];

const CLIENTS = [
  {
    name: "Claude Code og Codex",
    status: "Virker",
    note: "Tilføj MCP-serveren med din API-nøgle, eller brug agent-skillet.",
    ok: true,
  },
  {
    name: "Claude Desktop",
    status: "Virker",
    note: "Via konfigurationsfilen, som vist nedenfor.",
    ok: true,
  },
  {
    name: "Andre MCP-klienter med API-nøgle i en header",
    status: "Virker",
    note: "Fx Microsoft Copilot Studio, hvor IT-afdelingen sætter forbindelsen op.",
    ok: true,
  },
  {
    name: "claude.ai og ChatGPT",
    status: "Ikke endnu",
    note: "De kræver, at du logger ind via OAuth, når du tilføjer en egen MCP-server. TimeTrack bruger i dag API-nøgler, så de to kan ikke forbindes endnu.",
    ok: false,
  },
];

const FAQ = [
  {
    question: "Hvad er MCP?",
    answer:
      "Model Context Protocol er en åben standard, der lader AI-assistenter bruge værktøjer i andre programmer. TimeTracks MCP-server giver din assistent adgang til netop det, din API-nøgle tillader, i din egen konto.",
  },
  {
    question: "Kan jeg bruge ChatGPT eller claude.ai?",
    answer:
      "Ikke endnu. Begge kræver login via OAuth, når man tilføjer en egen MCP-server, og TimeTrack bruger i dag API-nøgler. Claude Code, Codex, Claude Desktop og andre klienter, der kan sende en API-nøgle, virker.",
  },
  {
    question: "Er det sikkert at give min AI-assistent adgang?",
    answer:
      "Adgangen styres af en API-nøgle, som en ejer eller administrator opretter under Indstillinger → API og kan tilbagekalde når som helst. Nøglens rettigheder håndhæves for hvert værktøj: en nøgle med kun læseadgang kan ikke oprette tidsposter eller sende fakturaer. Satser, klippekort-træk og validering ligger i TimeTrack, ikke hos assistenten.",
  },
  {
    question: "Skal jeg bruge AI for at registrere tid hurtigt?",
    answer:
      'Nej. I feltet "Skriv hvad du lavede" på tidsregistreringssiden kan du skrive en sætning som "2 timer på hjemmeside til Jensen i går". En dansk tekstfortolker uden AI udfylder formularen, og intet gemmes, før du har bekræftet.',
  },
  {
    question: "Koster AI-adgangen ekstra?",
    answer:
      "Nej. MCP-serveren, REST API'et og API-nøgler er med på alle planer. Fakturering og klippekort er også med på alle planer, når du bruger dem via din assistent.",
  },
];

export default function AiIntegrationPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <SEOPageLayout
      badge="MCP-server og REST API"
      title="Registrér tid og lav fakturaer med din AI-assistent"
      subtitle="Bed din assistent om at registrere timer, lave en fakturakladde eller finde ufaktureret tid. TimeTrack holder styr på satser, klippekort og regler."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedLinks={[
        {
          href: "/developers",
          title: "API-dokumentation",
          description: "REST API v1 med OpenAPI og agent-skill.",
        },
        {
          href: "/klippekort",
          title: "Klippekort",
          description: "Forudbetalte timer, der trækkes automatisk.",
        },
        {
          href: "/integrations",
          title: "Alle integrationer",
          description: "Billy, Dinero, e-conomic, Zapier, Make og n8n.",
        },
      ]}
      ctaTitle="Prøv det med din egen konto"
      ctaSubtitle="Opret en gratis konto, og find API-nøglen under Indstillinger → API."
    >
      {/* Eksempler */}
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="flex items-center gap-3 text-2xl font-bold text-slate-900 sm:text-3xl">
            <MessageSquare
              aria-hidden="true"
              className="h-7 w-7 shrink-0 text-brand-600"
            />
            Det kan du bede om
          </h2>
          <p className="mt-3 max-w-2xl text-slate-600">
            Fire eksempler, der virker i dag. Du skriver til din assistent, som
            du ville skrive til en kollega.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {EXAMPLES.map((ex) => (
              <div
                key={ex.title}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">{ex.title}</h3>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {ex.via}
                  </span>
                </div>
                <p className="mt-3 rounded-lg bg-slate-50 p-3 text-slate-800">
                  &ldquo;{ex.prompt}&rdquo;
                </p>
                <p className="mt-3 text-sm text-slate-600">{ex.how}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Hvilke assistenter */}
      <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="flex items-center gap-3 text-2xl font-bold text-slate-900 sm:text-3xl">
            <Bot
              aria-hidden="true"
              className="h-7 w-7 shrink-0 text-brand-600"
            />
            Hvilke assistenter virker i dag?
          </h2>
          <ul className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {CLIENTS.map((c) => (
              <li
                key={c.name}
                className="grid gap-1 p-5 sm:grid-cols-[16rem_7rem_1fr] sm:gap-6"
              >
                <p className="font-semibold text-slate-900">{c.name}</p>
                <p
                  className={
                    c.ok
                      ? "font-medium text-green-700"
                      : "font-medium text-amber-700"
                  }
                >
                  {c.status}
                </p>
                <p className="text-slate-600">{c.note}</p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50/60 p-5">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-600"
            />
            <p className="text-slate-700">
              API-nøglens rettigheder håndhæves for hvert værktøj. Giver du en
              nøgle kun læseadgang, kan assistenten slå op, men ikke oprette
              tidsposter, ændre noget eller sende fakturaer.
            </p>
          </div>
        </div>
      </section>

      {/* Uden AI */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="flex items-center gap-3 text-2xl font-bold text-slate-900 sm:text-3xl">
            <PenLine
              aria-hidden="true"
              className="h-7 w-7 shrink-0 text-brand-600"
            />
            Ingen AI-assistent? Skriv det bare i TimeTrack
          </h2>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-700">
            Øverst på tidsregistreringssiden ligger feltet &ldquo;Skriv hvad du
            lavede&rdquo;. Skriv fx &ldquo;2 timer på hjemmeside til Jensen i
            går&rdquo;, så udfylder TimeTrack varighed, dato og kunde for dig.
            Fortolkningen sker uden AI, og intet gemmes, før du har set
            forslaget og bekræftet det. Telefonens diktering virker også i
            feltet.
          </p>
        </div>
      </section>

      {/* Opsætning */}
      <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="flex items-center gap-3 text-2xl font-bold text-slate-900 sm:text-3xl">
            <KeyRound
              aria-hidden="true"
              className="h-7 w-7 shrink-0 text-brand-600"
            />
            Sådan forbinder du
          </h2>
          <ol className="mt-8 space-y-6">
            <li className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-slate-900">
                1. Opret en API-nøgle
              </h3>
              <p className="mt-1 text-slate-600">
                Gå til Indstillinger → API → &ldquo;Opret nøgle&rdquo;, og vælg,
                hvad assistenten må. Start gerne med kun læseadgang.
              </p>
            </li>
            <li className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-slate-900">
                2. Tilføj TimeTrack i din assistent
              </h3>
              <p className="mt-1 text-slate-600">I Claude Code:</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
                {`claude mcp add --transport http timetrack \\
  ${MCP_URL} \\
  --header "Authorization: Bearer DIN_API_NØGLE"`}
              </pre>
              <p className="mt-4 text-slate-600">
                I Claude Desktop (claude_desktop_config.json):
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
                {`{
  "mcpServers": {
    "timetrack": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${MCP_URL}",
        "--header",
        "Authorization:\${TIMETRACK_AUTH}"
      ],
      "env": { "TIMETRACK_AUTH": "Bearer DIN_API_NØGLE" }
    }
  }
}`}
              </pre>
            </li>
            <li className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-slate-900">3. Prøv det</h3>
              <p className="mt-1 text-slate-600">
                Spørg din assistent &ldquo;Hvem er jeg i TimeTrack?&rdquo; og
                derefter et af eksemplerne ovenfor.
              </p>
            </li>
          </ol>
          <p className="mt-8 text-slate-600">
            Bygger du selv agenter? Se{" "}
            <Link className="text-brand-700 underline" href="/developers">
              API-dokumentationen
            </Link>{" "}
            med OpenAPI og agent-skill, og{" "}
            <a className="text-brand-700 underline" href="/llms.txt">
              llms.txt
            </a>
            .
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
