import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "@/lib/billing/plan-gate";
import { getMarketingUrl } from "@/lib/config";

export function GET() {
  // Marketing-hosten (timetrack.dk) — IKKE app-hosten. Før host-splittet var
  // NEXT_PUBLIC_APP_URL begge dele; efter splittet pegede den på app.* og
  // gav forkerte URL'er til AI-crawlere.
  const baseUrl = getMarketingUrl();

  const body = `# TimeTrack (timetrack.dk)

TimeTrack is Danish time tracking for everyone: private individuals
(hobbies, studies, side projects, volunteering), freelancers, teams and
agencies, and companies. Freelancers get "klippekort" (prepaid hour packages
with automatic balance tracking) and invoicing via Billy and Dinero, plus
an e-conomic integration. Companies get check-in/out, holiday, absence, flex, overtime,
approvals and SSO (Microsoft Entra). Plans: Gratis (0 DKK, up to ${FREE_MAX_SEATS} users,
${FREE_MAX_ACTIVE_CLIENTS} clients), Privat 29 DKK/month (1 user, up to ${PRIVAT_MAX_ACTIVE_CLIENTS} active clients), Selvstændig 79 DKK/month (unlimited clients), Team 49 DKK/user/month,
Virksomhed 69 DKK/user/month, all excl. VAT. No setup fee. Web, browser extension and
desktop are included in every plan. Native iPhone/Android apps are in beta
testing (sign up at /timeregistrering-app) and coming to the app stores soon.
See ${baseUrl}/pricing for current prices.

## Primary URLs

- ${baseUrl}/
- ${baseUrl}/pricing
- ${baseUrl}/features
- ${baseUrl}/faq
- ${baseUrl}/vaerktoejer
- ${baseUrl}/skabeloner
- ${baseUrl}/contact

## Audience pages (Danish)

- ${baseUrl}/privat
- ${baseUrl}/selvstaendig
- ${baseUrl}/teams-og-bureauer
- ${baseUrl}/virksomheder

## Topic pages (Danish)

- ${baseUrl}/timeregistrering
- ${baseUrl}/tidsregistrering
- ${baseUrl}/tidsregistrering-software
- ${baseUrl}/timeregistrering-til-faktura
- ${baseUrl}/faktura-ud-fra-timer
- ${baseUrl}/klippekort
- ${baseUrl}/timeregistrering-freelancer
- ${baseUrl}/konsulent-timeregistrering

## Industry pages (Danish)

- ${baseUrl}/timeregistrering-fotograf
- ${baseUrl}/timeregistrering-udvikler
- ${baseUrl}/timeregistrering-konsulent
- ${baseUrl}/timeregistrering-designer
- ${baseUrl}/timeregistrering-oversaetter
- ${baseUrl}/timeregistrering-advokat
- ${baseUrl}/timeregistrering-revisor
- ${baseUrl}/timeregistrering-haandvaerker
- ${baseUrl}/tidsregistrering-lovkrav (Danish legal requirement to record employees' working time since 1 July 2024, with sources)

## Free tools

- ${baseUrl}/freelance-health-check (business health quiz, score 0-100)
- ${baseUrl}/timepris-beregner (hourly rate calculator)
- ${baseUrl}/klippekort-prisberegner (prepaid package pricing calculator)
- ${baseUrl}/team-prisberegner (TimeTrack price for a team by number of users)
- ${baseUrl}/ufaktureret-tid-beregner (unbilled time cost calculator)
- ${baseUrl}/moms-beregner (Danish VAT calculator)
- ${baseUrl}/minutter-til-timer (minutes to decimal hours converter with table)
- ${baseUrl}/daekningsgrad-beregner (contribution margin calculator)
- ${baseUrl}/belaegningsgrad-beregner (billable utilization calculator)
- ${baseUrl}/timepris-haandvaerker (tradesperson hourly rate calculator: electrician, carpenter, plumber)
- ${baseUrl}/timeloen-beregner (monthly salary to hourly wage converter)
- ${baseUrl}/skabeloner (downloadable templates: timesheet, invoice, quote)

## Integrations

- ${baseUrl}/billy
- ${baseUrl}/dinero
- ${baseUrl}/e-conomic
- ${baseUrl}/integrations/zapier
- ${baseUrl}/integrations/make
- ${baseUrl}/integrations/n8n
- ${baseUrl}/integrations/ai (AI assistant access via MCP)

## For AI agents

TimeTrack has first-class agent access:

- MCP endpoint (Model Context Protocol, streamable HTTP):
  https://app.timetrack.dk/api/v1/mcp. Authenticate with an API key
  (Bearer token). Tools: whoami, list/create clients, list/create/update
  time entries, unbilled summary, invoices (list, create from time
  entries, send).
- REST API v1 with OpenAPI spec: see ${baseUrl}/developers
- API keys are created by owners/admins under Settings → API, with
  scopes that are enforced per MCP tool (a read-only key cannot write).
- claude.ai and ChatGPT custom connectors require OAuth, which the MCP
  endpoint does not support yet; Claude Code, Codex, Claude Desktop (via
  mcp-remote) and other clients that send an API key header work.
- Setup guide: ${baseUrl}/integrations/ai

## Comparisons (Danish)

- ${baseUrl}/kundeskab-alternativ
- ${baseUrl}/effihub-alternativ
- ${baseUrl}/timeops-alternativ
- ${baseUrl}/toggl-alternativ
- ${baseUrl}/clockify-alternativ
- ${baseUrl}/harvest-alternativ
- ${baseUrl}/hourtick-alternativ
- ${baseUrl}/timely-alternativ
- ${baseUrl}/skift-fra-toggl
- ${baseUrl}/skift-fra-timeops

## Legal

- ${baseUrl}/privacy
- ${baseUrl}/terms
- ${baseUrl}/cookies
- ${baseUrl}/gdpr

## Sitemap

- ${baseUrl}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
