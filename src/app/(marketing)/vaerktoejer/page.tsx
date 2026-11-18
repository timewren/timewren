import {
  AlarmClock,
  BarChart3,
  Calculator,
  CalendarClock,
  Clock,
  CreditCard,
  Divide,
  FileSpreadsheet,
  FileText,
  Gauge,
  Hammer,
  Hourglass,
  Percent,
  PiggyBank,
  Receipt,
  Table,
  Timer,
  TrendingDown,
  Users,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

import { seoTools } from "@/lib/marketing/seo-tools";

export const metadata: Metadata = {
  title: "Gratis værktøjer til freelancere: beregnere, skabeloner og timere",
  description:
    "Gratis værktøjer til danske freelancere: health check, timepris-beregner, klippekort-prisberegner, moms-beregner, faktura-skabelon, stopur og meget mere. Ingen login.",
  alternates: { canonical: "/vaerktoejer" },
  openGraph: {
    title: "Gratis værktøjer til freelancere",
    description: "Gratis beregnere, skabeloner og timere. Ingen login.",
    url: "/vaerktoejer",
    type: "website",
    images: [
      {
        url: "/api/og?badge=Gratis%20v%C3%A6rkt%C3%B8jer&title=Gratis%20v%C3%A6rkt%C3%B8jer%20til%20freelancere&subtitle=15%20beregnere%2C%20skabeloner%20og%20timere%20%E2%80%94%20ingen%20login",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [
      "/api/og?badge=Gratis%20v%C3%A6rkt%C3%B8jer&title=Gratis%20v%C3%A6rkt%C3%B8jer%20til%20freelancere&subtitle=15%20beregnere%2C%20skabeloner%20og%20timere%20%E2%80%94%20ingen%20login",
    ],
  },
};

type Tool = {
  href: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

const CATEGORIES: { title: string; tools: Tool[] }[] = [
  {
    title: "Tjek din forretning",
    tools: [
      {
        href: "/freelance-health-check",
        title: "Freelance Health Check",
        description:
          "8 spørgsmål, 2 minutter: få en score 0-100 på din forretning og dine hurtigste gevinster.",
        icon: BarChart3,
      },
    ],
  },
  {
    title: "Priser & økonomi",
    tools: [
      {
        href: "/timepris-beregner",
        title: "Timepris-beregner",
        description:
          "Find din rigtige timepris ud fra ønsket indkomst, udgifter og fakturerbar tid.",
        icon: Calculator,
      },
      {
        href: "/klippekort-prisberegner",
        title: "Klippekort-prisberegner",
        description:
          "Hvad skal din 5/10/20-timers pakke koste? Pris, rabat og salgsargument.",
        icon: CreditCard,
      },
      {
        href: "/team-prisberegner",
        title: "Team-prisberegner",
        description:
          "Hvad koster tidsregistrering til jeres team? Vælg antal brugere og se prisen.",
        icon: Users,
      },
      {
        href: "/ufaktureret-tid-beregner",
        title: "Ufaktureret tid-beregner",
        description:
          "Se hvad glemte timer koster dig om året. De fleste taber 2-5 timer om ugen.",
        icon: TrendingDown,
      },
      {
        href: "/moms-beregner",
        title: "Moms-beregner",
        description: "Læg moms til eller træk moms fra, hurtigt og korrekt.",
        icon: Receipt,
      },
      {
        href: "/freelance-budget",
        title: "Freelance-budget",
        description:
          "Overblik over faste udgifter og hvad du skal omsætte for at nå din løn.",
        icon: PiggyBank,
      },
      {
        href: "/daekningsgrad-beregner",
        title: "Dækningsgrad-beregner",
        description:
          "Dækningsbidrag, dækningsgrad og nulpunkt, og prisen for den dækningsgrad du vil have.",
        icon: Percent,
      },
      {
        href: "/belaegningsgrad-beregner",
        title: "Belægningsgrad-beregner",
        description:
          "Hvor stor en del af din tid bliver faktureret, og hvad er et procentpoint værd?",
        icon: Gauge,
      },
      {
        href: "/timepris-haandvaerker",
        title: "Timepris for håndværkere",
        description:
          "Fra svendens løn og fakturerbare timer til timepris ekskl. og inkl. moms.",
        icon: Hammer,
      },
      {
        href: "/timeloen-beregner",
        title: "Timeløn-beregner",
        description: "Omregn månedsløn til timeløn og timeløn til månedsløn.",
        icon: Wallet,
      },
    ],
  },
  {
    title: "Fakturering & rapporter",
    tools: [
      {
        href: "/skabeloner",
        title: "Skabelon-bibliotek",
        description:
          "Download timeseddel, faktura, klippekort-aftale og tilbud som Excel/Word.",
        icon: FileText,
      },
      {
        href: "/faktura-skabelon",
        title: "Faktura-skabelon",
        description:
          "Gratis dansk faktura-skabelon med alle lovpligtige felter.",
        icon: FileText,
      },
      {
        href: "/timeseddel-skabelon",
        title: "Timeseddel-skabelon",
        description: "Klassisk timeseddel til print eller regneark.",
        icon: FileSpreadsheet,
      },
      {
        href: "/ugentlig-timerapport",
        title: "Ugentlig timerapport",
        description: "Saml ugens timer i en rapport du kan sende til kunden.",
        icon: BarChart3,
      },
      {
        href: "/klient-timer-oversigt",
        title: "Timeoversigt pr. kunde",
        description: "Hold styr på timer pr. kunde, uden regneark.",
        icon: Table,
      },
    ],
  },
  {
    title: "Arbejdstid, løn og projektøkonomi",
    tools: Object.values(seoTools).map(({ slug, title, description }) => ({
      href: `/${slug}`,
      title,
      description,
      icon: Calculator,
    })),
  },
  {
    title: "Tid & fokus",
    tools: [
      {
        href: "/online-stopur",
        title: "Online stopur",
        description: "Simpelt stopur i browseren: start, stop, nulstil.",
        icon: Timer,
      },
      {
        href: "/pomodoro-timer",
        title: "Pomodoro-timer",
        description: "25 minutters fokus, 5 minutters pause. Gentag.",
        icon: AlarmClock,
      },
      {
        href: "/arbejdstimer-beregner",
        title: "Arbejdstimer-beregner",
        description: "Beregn arbejdstimer mellem to tidspunkter eller datoer.",
        icon: Clock,
      },
      {
        href: "/minutter-til-timer",
        title: "Minutter til timer",
        description:
          "Omregn minutter til decimaltimer (100-dele) og tilbage, med tabel.",
        icon: Divide,
      },
      {
        href: "/arbejdstimer-pr-maaned",
        title: "Arbejdstimer pr. måned",
        description: "Normtimer pr. måned og år ved fuldtid og deltid.",
        icon: Clock,
      },
      {
        href: "/arbejdsdage-2026",
        title: "Arbejdsdage 2026",
        description: "Arbejdsdage og helligdage måned for måned.",
        icon: CalendarClock,
      },
      {
        href: "/projekt-deadline-beregner",
        title: "Projekt-deadline-beregner",
        description:
          "Kan projektet nås? Timer, arbejdsdage og buffer frem mod deadline.",
        icon: CalendarClock,
      },
      {
        href: "/nedtaelling-deadline",
        title: "Nedtælling til deadline",
        description: "Live nedtælling til din næste deadline.",
        icon: Hourglass,
      },
    ],
  },
];

export default function VaerktoejerPage() {
  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Gratis værktøjer til freelancere",
    itemListElement: CATEGORIES.flatMap((cat) => cat.tools).map((tool, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: tool.title,
      url: `https://timetrack.dk${tool.href}`,
    })),
  };

  return (
    <SEOPageLayout
      badge="Gratis værktøjer, ingen login"
      title="Gratis værktøjer til freelancere"
      subtitle="Beregnere, skabeloner og timere bygget til danske freelancere og konsulenter. Brug dem frit, uden login og uden betaling."
      jsonLd={itemListSchema}
      ctaTitle="Træt af at regne det hele ud i hånden?"
      ctaSubtitle="TimeTrack gør det automatisk: tid pr. kunde, klippekort-saldo og fakturagrundlag."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-16">
          {CATEGORIES.map((category) => (
            <div key={category.title}>
              <h2 className="text-2xl font-bold text-slate-900">
                {category.title}
              </h2>
              <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {category.tools.map((tool) => (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="group rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
                  >
                    <tool.icon className="mb-4 h-8 w-8 text-brand-600" />
                    <h3 className="mb-2 text-lg font-semibold text-slate-900 group-hover:text-brand-700">
                      {tool.title}
                    </h3>
                    <p className="text-sm text-slate-600">{tool.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </SEOPageLayout>
  );
}
