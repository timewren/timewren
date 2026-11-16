import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/Logo";
import { CVR } from "@/components/marketing/FounderNote";
import { SEGMENTS } from "@/lib/marketing/segments";

// `labelKey` er en nøgle i site.footer.link; `label` bruges til egennavne
// (Toggl, Clockify ...) og segmentnavne fra lib/marketing/segments.
type LinkItem = { href: string; label?: string; labelKey?: string };
type FooterColumn = { titleKey: string; links: LinkItem[] };

// Footeren er sitets vigtigste interne linkblok: alle landingssider,
// værktøjer og sammenligninger skal kunne nås herfra, så ingen side står
// uden interne links. Linkene er grupperet i fire hovedkolonner og to
// tættere lister nederst, i stedet for seks lige store kolonner.
const MAIN: FooterColumn[] = [
  {
    titleKey: "colProduct",
    links: [
      { href: "/features", labelKey: "features" },
      { href: "/pricing", labelKey: "pricing" },
      { href: "/klippekort", labelKey: "prepaid" },
      { href: "/kundeportal", labelKey: "clientPortal" },
      { href: "/integrations", labelKey: "integrations" },
      { href: "/browser-extension", labelKey: "browserExtension" },
      { href: "/desktop", labelKey: "desktopApp" },
      { href: "/timeregistrering-app", labelKey: "phoneApp" },
      { href: "/integrations/ai", labelKey: "aiAssistants" },
      { href: "/developers", labelKey: "developerApi" },
    ],
  },
  {
    titleKey: "colAudience",
    links: [
      ...SEGMENTS.map((s) => ({ href: s.path, label: s.label })),
      { href: "/timeregistrering-freelancer", labelKey: "freelancers" },
      { href: "/timeregistrering-konsulent", labelKey: "consultants" },
      { href: "/timeregistrering-designer", labelKey: "designers" },
      { href: "/timeregistrering-udvikler", labelKey: "developers" },
      { href: "/timeregistrering-fotograf", labelKey: "photographers" },
      { href: "/timeregistrering-oversaetter", labelKey: "translators" },
    ],
  },
  {
    titleKey: "colGuides",
    links: [
      { href: "/blog", labelKey: "blog" },
      { href: "/tidsregistrering", labelKey: "timeTrackingDa" },
      { href: "/timeregistrering", labelKey: "timeRegistration" },
      { href: "/gratis-tidsregistrering", labelKey: "freeTimeTracking" },
      {
        href: "/tidsregistrering-software",
        labelKey: "timeTrackingSoftware",
      },
      { href: "/timeregistrering-excel", labelKey: "timeTrackingExcel" },
      { href: "/timeseddel", labelKey: "timesheet" },
      { href: "/skabeloner", labelKey: "templates" },
      { href: "/arbejdstimer-pr-maaned", labelKey: "workHoursPerMonth" },
      { href: "/arbejdsdage-2026", labelKey: "workdays2026" },
      { href: "/faq", labelKey: "faq" },
      { href: "/changelog", labelKey: "news" },
    ],
  },
  {
    titleKey: "colCompany",
    links: [
      { href: "/about", labelKey: "about" },
      { href: "/contact", labelKey: "contact" },
      { href: "/tillid", labelKey: "trust" },
      { href: "/databehandleraftale", labelKey: "dpa" },
      { href: "/security-policy", labelKey: "security" },
      { href: "/privacy", labelKey: "privacy" },
      { href: "/terms", labelKey: "terms" },
      { href: "/cookies", labelKey: "cookies" },
      { href: "/gdpr", labelKey: "gdpr" },
      { href: "/sitemap-html", labelKey: "siteMap" },
    ],
  },
];

const COMPACT: FooterColumn[] = [
  {
    titleKey: "colCompare",
    links: [
      { href: "/toggl-alternativ", label: "Toggl" },
      { href: "/clockify-alternativ", label: "Clockify" },
      { href: "/harvest-alternativ", label: "Harvest" },
      { href: "/timelog-alternativ", label: "TimeLog" },
      { href: "/intempus-alternativ", label: "Intempus" },
      { href: "/effihub-alternativ", label: "Effihub" },
      { href: "/tidsmester-alternativ", label: "Tidsmester" },
      { href: "/timeops-alternativ", label: "TimeOps" },
      { href: "/timerr-alternativ", label: "Timerr" },
      { href: "/hourtick-alternativ", label: "Hourtick" },
    ],
  },
  {
    titleKey: "colFreeTools",
    links: [
      { href: "/vaerktoejer", labelKey: "allTools" },
      { href: "/online-stopur", labelKey: "onlineStopwatch" },
      { href: "/arbejdstimer-beregner", labelKey: "workHoursCalculator" },
      { href: "/timepris-beregner", labelKey: "hourlyRateCalculator" },
      { href: "/klippekort-prisberegner", labelKey: "prepaidPriceCalculator" },
      { href: "/timeseddel-skabelon", labelKey: "timesheetTemplate" },
      { href: "/faktura-skabelon", labelKey: "invoiceTemplate" },
      { href: "/moms-beregner", labelKey: "vatCalculator" },
      { href: "/freelance-budget", labelKey: "freelanceBudget" },
      { href: "/pomodoro-timer", labelKey: "pomodoroTimer" },
      { href: "/ugentlig-timerapport", labelKey: "weeklyReport" },
    ],
  },
];

const linkClass =
  "text-tt-graa underline-offset-2 hover:text-tt-blaek hover:underline";

/**
 * Sproget gives udtrykkeligt (marketing-layoutet er dansk): uden det læser
 * next-intl forespørgslen (cookies), og så kan marketingsiderne ikke længere
 * renderes statisk.
 */
export async function Footer({ locale = "da" }: { locale?: string } = {}) {
  const t = await getTranslations({ locale, namespace: "chrome.footer" });
  return (
    <footer className="tt-lys border-t border-tt-streg bg-tt-flade-varm py-16 text-tt-blaek">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_3fr]">
          <div>
            <Logo size="md" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-tt-graa">
              {t("tagline")}
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-tt-graa">
              {t.rich("madeBy", {
                cvr: CVR,
                link: (chunks) => (
                  <a
                    href="https://mahoje.dk"
                    target="_blank"
                    rel="noopener"
                    className="font-medium text-tt-blaek underline underline-offset-2"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
            <Link
              href="/tillid"
              className="mt-4 inline-block text-sm font-medium text-tt-gran underline underline-offset-2"
            >
              {t("trustLink")}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {MAIN.map((col) => (
              <div key={col.titleKey}>
                <p className="text-sm font-semibold">
                  {t(`link.${col.titleKey}`)}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={linkClass}>
                        {link.labelKey
                          ? t(`link.${link.labelKey}`)
                          : link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-6 border-t border-tt-streg pt-8 text-sm lg:grid-cols-2 lg:gap-12">
          {COMPACT.map((col) => (
            <div key={col.titleKey}>
              <p className="font-semibold">{t(`link.${col.titleKey}`)}</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClass}>
                      {link.labelKey ? t(`link.${link.labelKey}`) : link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-10 text-[13px] text-tt-graa">
          {t("copyright", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
