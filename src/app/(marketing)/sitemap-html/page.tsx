import Link from "next/link";

import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";

type LinkItem = { href: string; label: string; desc?: string };

const sections: { title: string; items: LinkItem[] }[] = [
  {
    title: "Kom i gang",
    items: [
      { href: "/", label: "Forside" },
      { href: "/pricing", label: "Priser" },
      { href: "/features", label: "Features" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Kontakt" },
    ],
  },
  {
    title: "Til hvem?",
    items: [
      { href: "/privat", label: "Privat" },
      { href: "/selvstaendig", label: "Selvstændige" },
      { href: "/teams-og-bureauer", label: "Teams og bureauer" },
      { href: "/virksomheder", label: "Virksomheder" },
    ],
  },
  {
    title: "Tidsregistrering / timeregistrering",
    items: [
      { href: "/timeregistrering", label: "Timeregistrering" },
      { href: "/tidsregistrering", label: "Tidsregistrering" },
      {
        href: "/timeregistrering-app",
        label: "Timeregistrering app",
      },
      {
        href: "/timeregistrering-til-faktura",
        label: "Timeregistrering til faktura",
      },
      { href: "/timer-til-faktura", label: "Timer til faktura" },
      { href: "/faktura-ud-fra-timer", label: "Faktura ud fra timer" },
      { href: "/fakturagrundlag", label: "Fakturagrundlag" },
      { href: "/timerapport", label: "Timerapport" },
      { href: "/kunde-rapport", label: "Kunde-rapport" },
      { href: "/registrere-timer", label: "Registrere timer" },
      { href: "/timeforbrug", label: "Timeforbrug" },
      { href: "/timepris", label: "Timepris" },
      { href: "/timeseddel", label: "Timeseddel" },
      {
        href: "/timeseddel-skabelon",
        label: "Timeseddel skabelon",
      },
    ],
  },
  {
    title: "Use cases",
    items: [
      {
        href: "/timeregistrering-freelancer",
        label: "Timeregistrering for freelancere",
      },
      {
        href: "/konsulent-timeregistrering",
        label: "Konsulent timeregistrering",
      },
      {
        href: "/timeregistrering-advokat",
        label: "Timeregistrering for advokater",
      },
      {
        href: "/timeregistrering-revisor",
        label: "Timeregistrering for revisorer",
      },
      {
        href: "/timeregistrering-haandvaerker",
        label: "Timeregistrering for håndværkere",
      },
      {
        href: "/tidsregistrering-lovkrav",
        label: "Lovkrav om tidsregistrering af medarbejdere",
      },
      {
        href: "/crm-freelancer",
        label: "Kunder, projekter og timer for freelancere",
      },
      {
        href: "/fakturering-freelancer",
        label: "Fakturering for freelancere",
      },
    ],
  },
  {
    title: "Klippekort / prepaid",
    items: [
      { href: "/klippekort", label: "Klippekort" },
      { href: "/prepaid-timer", label: "Prepaid timer" },
    ],
  },
  {
    title: "Integrationer",
    items: [
      { href: "/billy", label: "Billy" },
      { href: "/dinero", label: "Dinero" },
      { href: "/billy-timeregistrering", label: "Billy timeregistrering" },
      {
        href: "/dinero-timeregistrering",
        label: "Dinero timeregistrering",
      },
    ],
  },
  {
    title: "Teknisk",
    items: [
      { href: "/browser-extension", label: "Browser extension" },
      { href: "/timetracking", label: "Timetracking" },
      { href: "/time-tracking", label: "Time tracking" },
      { href: "/time-tracking-app", label: "Time tracking app" },
    ],
  },
  {
    title: "Sammenligninger",
    items: [
      { href: "/timeops-alternativ", label: "TimeOps alternativ" },
      { href: "/kundeskab-alternativ", label: "Kundeskab alternativ" },
      { href: "/intempus-alternativ", label: "Intempus alternativ" },
      { href: "/effihub-alternativ", label: "Effihub alternativ" },
      { href: "/toggl-alternativ", label: "Toggl alternativ" },
      { href: "/harvest-alternativ", label: "Harvest alternativ" },
      { href: "/clockify-alternativ", label: "Clockify alternativ" },
      { href: "/timelog-alternativ", label: "Timelog alternativ" },
      { href: "/hourtick-alternativ", label: "Hourtick alternativ" },
      { href: "/timely-alternativ", label: "Timely alternativ" },
    ],
  },
  {
    title: "Om / juridisk",
    items: [
      { href: "/about", label: "Om" },
      { href: "/privacy", label: "Privatlivspolitik" },
      { href: "/terms", label: "Servicevilkår" },
      { href: "/cookies", label: "Cookie politik" },
      { href: "/gdpr", label: "GDPR" },
      { href: "/tillid", label: "Tillid og data" },
    ],
  },
];

export default function HtmlSitemapPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        title="Sitemap"
        subtitle="En oversigt over de vigtigste sider på timetrack.dk."
      >
        <p className="mt-2 text-center text-sm text-slate-500">
          XML-sitemap findes på{" "}
          <a className="underline hover:text-brand-600" href="/sitemap.xml">
            /sitemap.xml
          </a>
          .
        </p>
      </MarketingHero>

      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-4xl gap-10">
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="mb-4 text-2xl font-semibold text-slate-900">
                {section.title}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {section.items.map((item) => (
                  <li key={item.href} className="text-slate-700">
                    <Link
                      href={item.href}
                      className="text-brand-700 transition-colors hover:text-brand-800"
                    >
                      {item.label}
                    </Link>
                    {item.desc ? (
                      <span className="text-slate-500">: {item.desc}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
