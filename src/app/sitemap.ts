import type { MetadataRoute } from "next";
import { getMarketingUrl } from "@/lib/config";
import { seoPagePaths } from "@/lib/marketing/arbejdsdage-seo";
import { seoTools } from "@/lib/marketing/seo-tools";
import { isMarketingEnabled } from "@/lib/marketing-guard";

export default function sitemap(): MetadataRoute.Sitemap {
  // Selvhostet instans uden marketingsider: ingen sider at udstille (#968).
  if (!isMarketingEnabled()) return [];

  // Sitemap always points at the marketing host (timetrack.dk).
  const baseUrl = getMarketingUrl();
  const now = new Date();

  const urls: Array<{
    path: string;
    changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority?: number;
  }> = [
    { path: "/", changeFrequency: "weekly", priority: 1 },

    // Main marketing
    { path: "/pricing", changeFrequency: "monthly", priority: 0.95 },
    { path: "/features", changeFrequency: "monthly", priority: 0.9 },
    { path: "/faq", changeFrequency: "monthly", priority: 0.85 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.6 },
    { path: "/about", changeFrequency: "yearly", priority: 0.5 },

    // Målgruppe-segmenter (positionering: tidsregistrering til alle)
    { path: "/privat", changeFrequency: "monthly", priority: 0.85 },
    { path: "/selvstaendig", changeFrequency: "monthly", priority: 0.85 },
    { path: "/teams-og-bureauer", changeFrequency: "monthly", priority: 0.85 },
    { path: "/virksomheder", changeFrequency: "monthly", priority: 0.85 },

    // Core SEO pages
    { path: "/timeregistrering", changeFrequency: "monthly", priority: 0.9 },
    { path: "/tidsregistrering", changeFrequency: "monthly", priority: 0.85 },
    {
      path: "/tidsregistrering-software",
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      path: "/timeregistrering-til-faktura",
      changeFrequency: "monthly",
      priority: 0.9,
    },
    { path: "/timer-til-faktura", changeFrequency: "monthly", priority: 0.8 },
    {
      path: "/faktura-ud-fra-timer",
      changeFrequency: "monthly",
      priority: 0.85,
    },
    { path: "/fakturagrundlag", changeFrequency: "monthly", priority: 0.85 },
    { path: "/timerapport", changeFrequency: "monthly", priority: 0.75 },
    { path: "/kunde-rapport", changeFrequency: "monthly", priority: 0.7 },
    { path: "/registrere-timer", changeFrequency: "monthly", priority: 0.7 },
    { path: "/timeforbrug", changeFrequency: "monthly", priority: 0.7 },
    { path: "/timepris", changeFrequency: "monthly", priority: 0.7 },
    { path: "/timeseddel", changeFrequency: "monthly", priority: 0.7 },
    { path: "/timeseddel-skabelon", changeFrequency: "monthly", priority: 0.7 },

    // Use cases
    {
      path: "/timeregistrering-freelancer",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    {
      path: "/konsulent-timeregistrering",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    { path: "/crm-freelancer", changeFrequency: "monthly", priority: 0.75 },
    {
      path: "/timeregistrering-fotograf",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeregistrering-udvikler",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeregistrering-konsulent",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeregistrering-designer",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeregistrering-oversaetter",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeregistrering-advokat",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeregistrering-revisor",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeregistrering-haandvaerker",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/tidsregistrering-lovkrav",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      path: "/fakturering-freelancer",
      changeFrequency: "monthly",
      priority: 0.75,
    },

    // Klippekort / prepaid
    { path: "/klippekort", changeFrequency: "monthly", priority: 0.8 },
    { path: "/prepaid-timer", changeFrequency: "monthly", priority: 0.75 },

    // Integrations
    { path: "/integrations", changeFrequency: "monthly", priority: 0.7 },
    {
      path: "/integrations/economic",
      changeFrequency: "monthly",
      priority: 0.65,
    },
    { path: "/integrations/make", changeFrequency: "monthly", priority: 0.6 },
    { path: "/integrations/n8n", changeFrequency: "monthly", priority: 0.6 },
    {
      path: "/integrations/zapier",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    { path: "/integrations/ai", changeFrequency: "monthly", priority: 0.7 },
    { path: "/billy", changeFrequency: "monthly", priority: 0.75 },
    { path: "/dinero", changeFrequency: "monthly", priority: 0.75 },
    {
      path: "/billy-timeregistrering",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/dinero-timeregistrering",
      changeFrequency: "monthly",
      priority: 0.7,
    },

    // Product surface pages
    { path: "/desktop", changeFrequency: "monthly", priority: 0.6 },
    { path: "/download", changeFrequency: "monthly", priority: 0.55 },
    { path: "/developers", changeFrequency: "monthly", priority: 0.5 },
    { path: "/browser-extension", changeFrequency: "monthly", priority: 0.6 },
    {
      path: "/timeregistrering-app",
      changeFrequency: "monthly",
      priority: 0.65,
    },
    { path: "/timetracking", changeFrequency: "monthly", priority: 0.6 },
    { path: "/time-tracking", changeFrequency: "monthly", priority: 0.6 },
    { path: "/time-tracking-app", changeFrequency: "monthly", priority: 0.6 },

    // Free tools
    ...Object.values(seoTools).map(({ slug }) => ({
      path: `/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { path: "/vaerktoejer", changeFrequency: "monthly", priority: 0.8 },
    { path: "/skabeloner", changeFrequency: "monthly", priority: 0.75 },
    {
      path: "/freelance-health-check",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    { path: "/online-stopur", changeFrequency: "monthly", priority: 0.6 },
    { path: "/timepris-beregner", changeFrequency: "monthly", priority: 0.7 },
    {
      path: "/klippekort-prisberegner",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    { path: "/team-prisberegner", changeFrequency: "monthly", priority: 0.75 },
    {
      path: "/ufaktureret-tid-beregner",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    { path: "/faktura-skabelon", changeFrequency: "monthly", priority: 0.7 },
    {
      path: "/arbejdstimer-beregner",
      changeFrequency: "monthly",
      priority: 0.65,
    },
    {
      path: "/arbejdstimer-pr-maaned",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    {
      path: "/gratis-tidsregistrering",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    // Programmatiske sider: hub, år, måneder og arbejdstimer pr. år
    ...seoPagePaths().map((path) => ({
      path,
      changeFrequency: "yearly" as const,
      priority: path === "/arbejdsdage" ? 0.8 : 0.7,
    })),
    {
      path: "/ugentlig-timerapport",
      changeFrequency: "monthly",
      priority: 0.65,
    },
    { path: "/moms-beregner", changeFrequency: "monthly", priority: 0.65 },
    {
      path: "/minutter-til-timer",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/daekningsgrad-beregner",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/belaegningsgrad-beregner",
      changeFrequency: "monthly",
      priority: 0.65,
    },
    {
      path: "/timepris-haandvaerker",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/timeloen-beregner",
      changeFrequency: "monthly",
      priority: 0.65,
    },
    { path: "/freelance-budget", changeFrequency: "monthly", priority: 0.6 },
    {
      path: "/projekt-deadline-beregner",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      path: "/klient-timer-oversigt",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      path: "/nedtaelling-deadline",
      changeFrequency: "monthly",
      priority: 0.55,
    },
    { path: "/pomodoro-timer", changeFrequency: "monthly", priority: 0.6 },

    // More product pages
    { path: "/projektstyring", changeFrequency: "monthly", priority: 0.65 },
    { path: "/projektplanlaegning", changeFrequency: "monthly", priority: 0.6 },
    { path: "/kundeportal", changeFrequency: "monthly", priority: 0.65 },
    {
      path: "/timeregistrering-excel",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    { path: "/e-conomic", changeFrequency: "monthly", priority: 0.7 },

    // Blog
    { path: "/blog", changeFrequency: "weekly", priority: 0.7 },
    {
      path: "/blog/timeregistrering-freelancer-guide",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      path: "/blog/klippekort-freelancer",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    {
      path: "/blog/klippekort-skabelon",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    {
      path: "/blog/tidsregistrering-medarbejdere-systemer",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      path: "/blog/klippekort-vs-fastpris",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/blog/vaelg-tidsregistrering",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    {
      path: "/blog/dinero-timeregistrering-guide",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/blog/tidsregistrering-lov-danmark",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/blog/fakturering-fejl-freelancer",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/blog/freelancer-timepris-2026",
      changeFrequency: "monthly",
      priority: 0.75,
    },
    {
      path: "/blog/billy-timeregistrering-guide",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/blog/excel-til-timerapport",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      path: "/blog/desktop-app-coming-soon",
      changeFrequency: "monthly",
      priority: 0.5,
    },

    // Comparison / switching
    { path: "/skift-fra-toggl", changeFrequency: "monthly", priority: 0.75 },
    { path: "/skift-fra-timeops", changeFrequency: "monthly", priority: 0.75 },
    { path: "/timeops-alternativ", changeFrequency: "monthly", priority: 0.8 },
    {
      path: "/kundeskab-alternativ",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    { path: "/intempus-alternativ", changeFrequency: "monthly", priority: 0.8 },
    { path: "/effihub-alternativ", changeFrequency: "monthly", priority: 0.8 },
    { path: "/toggl-alternativ", changeFrequency: "monthly", priority: 0.8 },
    { path: "/harvest-alternativ", changeFrequency: "monthly", priority: 0.8 },
    { path: "/clockify-alternativ", changeFrequency: "monthly", priority: 0.8 },
    { path: "/timelog-alternativ", changeFrequency: "monthly", priority: 0.8 },
    {
      path: "/tidsmester-alternativ",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    { path: "/timerr-alternativ", changeFrequency: "monthly", priority: 0.8 },
    { path: "/hourtick-alternativ", changeFrequency: "monthly", priority: 0.8 },
    { path: "/timely-alternativ", changeFrequency: "monthly", priority: 0.8 },

    // Other
    { path: "/changelog", changeFrequency: "weekly", priority: 0.5 },
    { path: "/roadmap", changeFrequency: "monthly", priority: 0.4 },
    { path: "/security-policy", changeFrequency: "yearly", priority: 0.3 },
    { path: "/tillid", changeFrequency: "monthly", priority: 0.5 },
    {
      path: "/databehandleraftale",
      changeFrequency: "monthly",
      priority: 0.4,
    },

    // Hygiene
    { path: "/sitemap-html", changeFrequency: "yearly", priority: 0.2 },
    { path: "/llms.txt", changeFrequency: "monthly", priority: 0.1 },

    // Legal
    { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
    { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
    { path: "/slet-konto", changeFrequency: "yearly", priority: 0.2 },
    { path: "/cookies", changeFrequency: "yearly", priority: 0.2 },
    { path: "/gdpr", changeFrequency: "yearly", priority: 0.2 },
  ];

  return urls.map(({ path, changeFrequency, priority }) => ({
    url: path === "/" ? baseUrl : `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
