# Forbind TimeTrack med n8n

n8n er en open source automationsplatform der kan forbindes direkte med TimeTrack's REST API. Du kan hoste n8n selv eller bruge n8n Cloud.

Kildekode: [`integrations/n8n/`](../../integrations/n8n/)

---

## Opsætning

### 1. Opret en API-nøgle

1. Gå til **TimeTrack → Indstillinger → API Nøgler**
2. Klik "Opret ny nøgle"
3. Giv den et navn (f.eks. "n8n integration")
4. Vælg de scopes du har brug for (eller "Alle rettigheder")
5. Kopier nøglen — den vises kun én gang

### 2. Konfigurer n8n Credentials

I n8n, opret en **Header Auth**-credential:

- **Name:** `Authorization`
- **Value:** `Bearer tk_live_din_nøgle_her`

Brug denne credential i alle **HTTP Request**-noder der kalder TimeTrack.

### 3. Webhook Trigger (valgfrit)

For at modtage events fra TimeTrack i n8n:

1. Tilføj en **Webhook**-node i n8n og kopier webhook-URL'en
2. I TimeTrack: gå til **Indstillinger → Webhooks → Opret ny**
3. Indsæt n8n webhook-URL'en
4. Vælg de events du vil lytte til (se listen nedenfor)
5. Gem — TimeTrack sender nu events til n8n automatisk

---

## Tilgængelige webhook-events

| Event                 | Hvornår sendes det              |
| --------------------- | ------------------------------- |
| `time_entry.created`  | Ny tidsregistrering oprettet    |
| `time_entry.updated`  | Tidsregistrering opdateret      |
| `client.created`      | Ny klient oprettet              |
| `invoice.created`     | Ny faktura oprettet             |
| `invoice.paid`        | Faktura markeret som betalt     |
| `prepaid.low_balance` | Klippekort under minimumsgrænse |
| `task.completed`      | Opgave markeret som udført      |

---

## API Endpoints

| Endpoint                       | Metode              | Beskrivelse                     |
| ------------------------------ | ------------------- | ------------------------------- |
| `/api/v1/me`                   | GET                 | Brugerinfo + API key validering |
| `/api/v1/clients`              | GET / POST          | Klienter                        |
| `/api/v1/projects`             | GET / POST          | Projekter                       |
| `/api/v1/time-entries`         | GET / POST          | Tidsregistreringer              |
| `/api/v1/timer`                | GET / POST / DELETE | Timer start/stop                |
| `/api/v1/invoices`             | GET / POST          | Fakturaer                       |
| `/api/v1/tasks`                | GET / POST          | Opgaver                         |
| `/api/v1/webhooks`             | GET / POST / DELETE | Administrer webhooks            |
| `/api/v1/reports/time-summary` | GET                 | Tidsrapport (fra/til dato)      |
| `/api/v1/reports/revenue`      | GET                 | Omsætningsrapport               |

Fuld API-dokumentation: https://timetrack.dk/api/v1/docs

---

## Rate limits

TimeTrack API'et tillader **100 requests pr. minut** per API nøgle. Rate limit-status fremgår af response-headers:

- `X-RateLimit-Limit` — maksimalt antal requests pr. minut
- `X-RateLimit-Remaining` — resterende requests i det aktuelle vindue
- `X-RateLimit-Reset` — Unix timestamp for reset

---

## Eksempel-workflows

### Daglig tidsrapport til Slack

1. **Schedule Trigger** → Kører kl. 17:00 hver dag
2. **HTTP Request** → `GET /api/v1/reports/time-summary?from={{ $now.format('yyyy-MM-dd') }}&to={{ $now.format('yyyy-MM-dd') }}`
3. **Slack** → Send besked til `#team-updates` med dagens timer

Et komplet workflow-eksempel kan importeres fra [`integrations/n8n/example-workflow.json`](../../integrations/n8n/example-workflow.json).

### Ny klient → Google Sheets

1. **Webhook** → Modtager `client.created` event fra TimeTrack
2. **Google Sheets** → Tilføj ny række med klientens data (navn, email, CVR)

### Faktura betalt → Email notifikation

1. **Webhook** → Modtager `invoice.paid` event
2. **Send Email** → "Faktura #{{invoiceNumber}} er betalt — {{totalAmount}} DKK"

### Ugentlig time-opsummering til Notion

1. **Schedule Trigger** → Kører mandag morgen
2. **HTTP Request** → `GET /api/v1/reports/time-summary` for den foregående uge
3. **Notion** → Opret ny side i din projektstatus-database

---

## Links

- Fuld API-dokumentation: https://timetrack.dk/api/v1/docs
- API Nøgler: https://timetrack.dk/dashboard/settings/integrations
- Eksempel-workflow: [`integrations/n8n/example-workflow.json`](../../integrations/n8n/example-workflow.json)
