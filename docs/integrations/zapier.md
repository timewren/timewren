# Forbind TimeTrack med Zapier

Zapier lader dig automatisere opgaver ved at forbinde TimeTrack med 6.000+ andre apps — uden at skrive kode.

Kildekode: [`integrations/zapier/`](../../integrations/zapier/)

---

## Autentificering

TimeTrack Zapier-integrationen bruger **API Key**-autentificering.

1. Gå til **TimeTrack → Indstillinger → API Nøgler**
2. Klik "Opret ny nøgle" og giv den et navn (f.eks. "Zapier")
3. Vælg de scopes du har brug for, eller vælg "Alle rettigheder"
4. Kopier nøglen — den vises kun én gang
5. I Zapier: indsæt nøglen i feltet **API Key** og brug `https://timetrack.dk` som **Base URL**

Zapier verificerer forbindelsen ved at kalde `GET /api/v1/me`.

---

## Triggers

Alle triggers er **webhook-baserede** — TimeTrack registrerer automatisk en webhook hos Zapier når du aktiverer en Zap, og sletter den igen når du deaktiverer den.

| Trigger                     | Hændelse              | Beskrivelse                          |
| --------------------------- | --------------------- | ------------------------------------ |
| New Time Entry              | `time_entry.created`  | Ny tidsregistrering oprettet         |
| Time Entry Updated          | `time_entry.updated`  | Eksisterende tidsregistrering ændret |
| New Client                  | `client.created`      | Ny klient oprettet                   |
| New Invoice                 | `invoice.created`     | Ny faktura oprettet                  |
| Invoice Paid                | `invoice.paid`        | Faktura markeret som betalt          |
| Prepaid Package Low Balance | `prepaid.low_balance` | Klippekort under minimumsgrænse      |
| Task Completed              | `task.completed`      | Opgave markeret som udført           |

---

## Actions

| Action            | Endpoint                    | Beskrivelse                         |
| ----------------- | --------------------------- | ----------------------------------- |
| Create Time Entry | `POST /api/v1/time-entries` | Opret en ny tidsregistrering        |
| Create Client     | `POST /api/v1/clients`      | Opret en ny klient                  |
| Create Task       | `POST /api/v1/tasks`        | Opret en ny opgave under et projekt |
| Start Timer       | `POST /api/v1/timer`        | Start en løbende timer              |
| Stop Timer        | `DELETE /api/v1/timer`      | Stop den aktive timer               |

---

## Searches

| Search       | Endpoint                         | Beskrivelse                         |
| ------------ | -------------------------------- | ----------------------------------- |
| Find Client  | `GET /api/v1/clients?q=`         | Find klient via navn eller email    |
| Find Project | `GET /api/v1/projects?clientId=` | Find projekter tilknyttet en klient |

---

## Rate limits

TimeTrack API'et tillader **100 requests pr. minut** per API nøgle. Zapier genner typisk langt under denne grænse. Rate limit-status returneres i response-headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`).

---

## Eksempel-Zaps

### Ny tidsregistrering → Google Sheets

1. **Trigger:** New Time Entry (TimeTrack)
2. **Action:** Create Spreadsheet Row (Google Sheets)
   - Mapper `date`, `hours`, `description`, `projectId` til kolonner

### Faktura betalt → Slack notifikation

1. **Trigger:** Invoice Paid (TimeTrack)
2. **Action:** Send Channel Message (Slack)
   - Besked: `"Faktura {{invoiceNumber}} er betalt — {{totalAmount}} DKK"`

### Klippekort lav saldo → Email påmindelse

1. **Trigger:** Prepaid Package Low Balance (TimeTrack)
2. **Action:** Send Email (Gmail/Outlook)
   - Advarer klienten om at klippekortet snart er opbrugt

### Ny opgave fra Notion → TimeTrack

1. **Trigger:** New Database Item (Notion)
2. **Action:** Create Task (TimeTrack)
   - Synkroniserer opgaver fra Notion til TimeTrack automatisk

---

## Links

- Fuld API-dokumentation: https://timetrack.dk/api/v1/docs
- API Nøgler: https://timetrack.dk/dashboard/settings/integrations
- Kildekode: [`integrations/zapier/index.js`](../../integrations/zapier/index.js)
