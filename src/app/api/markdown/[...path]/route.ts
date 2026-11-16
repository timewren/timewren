import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/config";
import {
  AFTER_TRIAL_SOLO,
  PLAN_PRICES,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";

const BASE_URL = getAppUrl();

function homeMarkdown(): string {
  return `# TimeTrack: tidsregistrering for danske freelancere

TimeTrack er et dansk tidsregistreringssystem med klippekort, bygget til freelancere og konsulenter.

## Kernefunktioner

- **Tidsregistrering:** Start/stop-timer, manuel registrering, ugentligt timesheet
- **Klippekort:** Forudbetalte timepakker. Kunder køber en blok timer; tidsposter trækkes fra saldoen
- **Kundehåndtering:** CVR-opslag, kontaktpersoner, satser, arkivering
- **Projektstyring:** Timesatser, faste priser, klippekort-kobling
- **Fakturering:** Opret fakturaer fra registreret tid, send og spor betaling
- **Rapportering:** Tids- og omsætningsrapporter med eksport til CSV, XLSX, JSON, PDF
- **Opgavestyring:** Kanban og listevisning med prioritering
- **Danske integrationer:** CVR, Billy, Dinero, e-conomic

## API

TimeTrack har en offentlig REST API til integration med andre systemer.

- OpenAPI-spec: [${BASE_URL}/api/v1/openapi.json](${BASE_URL}/api/v1/openapi.json)
- API-dokumentation: [${BASE_URL}/api/v1/docs](${BASE_URL}/api/v1/docs)
- Autentificering: \`X-API-Key\` header

## Links

- Hjemmeside: [${BASE_URL}](${BASE_URL})
- Priser: [${BASE_URL}/pricing](${BASE_URL}/pricing)
- Funktioner: [${BASE_URL}/features](${BASE_URL}/features)
- FAQ: [${BASE_URL}/faq](${BASE_URL}/faq)
- Kontakt: [${BASE_URL}/contact](${BASE_URL}/contact)
`;
}

function pricingMarkdown(): string {
  const plans = Object.values(PLAN_PRICES)
    .map((p) => {
      const price = [p.price, p.extra].filter(Boolean).join(", ");
      return `- **${p.name}:** ${p.includes}. Pris: ${price}`;
    })
    .join("\n");

  return `# TimeTrack: priser

TimeTrack tilbyder fleksible prisplaner for danske freelancere og konsulenter.

## Planer

${plans}

${VAT_NOTE}

Besøg [${BASE_URL}/pricing](${BASE_URL}/pricing) for aktuelle priser og funktionsoversigt.

## Gratis prøveperiode

Start med en gratis prøveperiode på ${TRIAL_DAYS} dage. ${AFTER_TRIAL_SOLO}

## API-adgang

API-adgang er inkluderet i betalte planer. Se [API-dokumentation](${BASE_URL}/api/v1/docs).
`;
}

function featuresMarkdown(): string {
  return `# TimeTrack: funktioner

## Tidsregistrering
- Start/stop-timer med et klik
- Manuel tidsregistrering
- Ugentligt timesheet-overblik
- Browser-extension til hurtig registrering

## Klippekort (forudbetalte timer)
- Kunder køber en blok timer på forhånd
- Tidsposter trækkes automatisk fra saldoen
- Overblik over forbrug og resterende timer

## Kundehåndtering
- CVR-opslag for danske virksomheder
- Kontaktpersoner og noter
- Individuelle satser per kunde
- Arkivering (soft delete)

## Projektstyring
- Timesatser, faste priser, klippekort
- Satshistorik med ændringslog
- Projekt-tags og kategorisering

## Fakturering
- Opret fakturaer fra registreret tid
- Linjepost-redigering
- Afsend og spor betaling
- Integration med danske regnskabssystemer

## Rapportering
- Tids- og omsætningsrapporter
- Filtrering og gruppering
- Eksport: CSV, XLSX, JSON, PDF

## Opgavestyring
- Kanban-board og listevisning
- Prioritering og deadlines
- Projekt- og kundekobling

## Integrationer
- CVR-registret (dansk virksomhedsdata)
- Billy, Dinero, e-conomic (regnskab)
- REST API til egne integrationer

## API
- OpenAPI-spec: [${BASE_URL}/api/v1/openapi.json](${BASE_URL}/api/v1/openapi.json)
- Dokumentation: [${BASE_URL}/api/v1/docs](${BASE_URL}/api/v1/docs)
`;
}

function faqMarkdown(): string {
  return `# TimeTrack: FAQ

## Hvad er TimeTrack?
TimeTrack er et dansk tidsregistreringssystem med klippekort, bygget til freelancere og konsulenter.

## Hvad er klippekort?
Klippekort er forudbetalte timepakker. Din kunde køber f.eks. 20 timer, og hver tidsregistrering trækker automatisk fra saldoen.

## Har TimeTrack en API?
Ja. TimeTrack har en offentlig REST API med API-nøgle-autentificering. Se [API-dokumentation](${BASE_URL}/api/v1/docs).

## Hvilke regnskabssystemer integrerer TimeTrack med?
Billy, Dinero og e-conomic.

## Kan jeg eksportere mine data?
Ja, rapporter kan eksporteres til CSV, XLSX, JSON og PDF.

## Understøtter TimeTrack CVR-opslag?
Ja, TimeTrack slår automatisk danske virksomhedsoplysninger op via CVR-registret.

## Kontakt
Besøg [${BASE_URL}/contact](${BASE_URL}/contact) for kontaktoplysninger.
`;
}

function contactMarkdown(): string {
  return `# TimeTrack: kontakt

Besøg [${BASE_URL}/contact](${BASE_URL}/contact) for kontaktoplysninger og supportmuligheder.

## API-support
For API-relaterede spørgsmål, se [API-dokumentation](${BASE_URL}/api/v1/docs).
`;
}

const MARKDOWN_PAGES: Record<string, () => string> = {
  home: homeMarkdown,
  pricing: pricingMarkdown,
  features: featuresMarkdown,
  faq: faqMarkdown,
  contact: contactMarkdown,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const page = path.join("/");
  const generator = MARKDOWN_PAGES[page];

  if (!generator) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(generator(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
