# Forbind TimeTrack med Make (tidligere Integromat)

Make er en visuel automationsplatform der lader dig bygge workflows — kaldet **scenarier** — ved at forbinde moduler fra hundredvis af apps. TimeTrack understøttes som et **Custom App** i Make.

Kildekode: [`integrations/make/`](../../integrations/make/)

---

## Opsætning

### 1. Opret API-nøgle

1. Gå til **TimeTrack → Indstillinger → API Nøgler**
2. Klik "Opret ny nøgle" og giv den et navn (f.eks. "Make")
3. Vælg de scopes du har brug for, eller vælg "Alle rettigheder"
4. Kopier nøglen — den vises kun én gang

### 2. Installer Custom App i Make

1. Gå til **Make → Custom Apps → Create a new app**
2. Importér definitionen fra [`integrations/make/modules.json`](../../integrations/make/modules.json)
3. Sæt **Base URL** til `https://timetrack.dk`

### 3. Opret forbindelse

I Make opretter du en **Connection** med:

- **Type:** API Key
- **Authorization Header:** `Authorization: Bearer <din-nøgle>`
- **Test URL:** `GET /api/v1/me`

---

## Moduler

### Watch-triggere (webhook-baserede)

Watch-modulerne abonnerer automatisk på TimeTrack webhooks — Make registrerer og afmelder selv.

| Modul                     | Hændelse              | Beskrivelse                     |
| ------------------------- | --------------------- | ------------------------------- |
| Watch New Time Entries    | `time_entry.created`  | Ny tidsregistrering oprettet    |
| Watch Time Entry Updated  | `time_entry.updated`  | Tidsregistrering opdateret      |
| Watch New Clients         | `client.created`      | Ny klient oprettet              |
| Watch New Invoices        | `invoice.created`     | Ny faktura oprettet             |
| Watch Invoice Paid        | `invoice.paid`        | Faktura markeret som betalt     |
| Watch Prepaid Low Balance | `prepaid.low_balance` | Klippekort under minimumsgrænse |
| Watch Task Completed      | `task.completed`      | Opgave fuldført                 |

### Actions

| Modul             | Endpoint                    | Felter                                                            |
| ----------------- | --------------------------- | ----------------------------------------------------------------- |
| Create Time Entry | `POST /api/v1/time-entries` | projectId\*, description\*, date\*, durationMinutes\*, isBillable |
| Create Client     | `POST /api/v1/clients`      | name\*, email, phone, company, cvrNumber                          |
| Create Task       | `POST /api/v1/tasks`        | projectId\*, title\*, description, status, priority               |
| Start Timer       | `POST /api/v1/timer`        | projectId, clientId, description                                  |
| Stop Timer        | `DELETE /api/v1/timer`      | — (stopper aktiv timer)                                           |

\* Påkrævet felt

### Searches

| Modul        | Endpoint                         | Beskrivelse                  |
| ------------ | -------------------------------- | ---------------------------- |
| Find Client  | `GET /api/v1/clients?q=`         | Søg på navn eller email      |
| Find Project | `GET /api/v1/projects?clientId=` | Hent projekter for en klient |

---

## Rate limits

TimeTrack API'et tillader **100 requests pr. minut** per API nøgle. Rate limit-status fremgår af response-headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`). Makes standardpause mellem operationer er tilstrækkelig under normale forhold.

---

## Eksempel-scenarier

### Daglig timerapport til email

1. **Schedule** → Kører kl. 17:00 hver hverdag
2. **HTTP Request** → `GET /api/v1/reports/time-summary?from={{today}}&to={{today}}`
3. **Email** → Send opsummering til dig selv

### Ny klient synkroniseret til HubSpot/Pipedrive

1. **Watch New Clients** (TimeTrack) → Ny klient oprettet
2. **Create Contact** (HubSpot eller Pipedrive) → Opret kontakt med klientens data

### Faktura betalt → Regnskabssystem

1. **Watch Invoice Paid** (TimeTrack) → Faktura betalt
2. **Create Entry** (Billy / Dinero / Google Sheets) → Bogfør betalingen

### GitHub issue lukket → TimeTrack opgave fuldført

1. **Watch Issues** (GitHub) → Issue lukket
2. **Find Project** (TimeTrack) → Slå projektet op via klient-ID
3. **Create Task** (TimeTrack) → Opret en afsluttet opgave med titlen fra GitHub

---

## Links

- Fuld API-dokumentation: https://timetrack.dk/api/v1/docs
- API Nøgler: https://timetrack.dk/dashboard/settings/integrations
- Modulkonfiguration: [`integrations/make/modules.json`](../../integrations/make/modules.json)
