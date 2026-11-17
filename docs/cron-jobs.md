# Cron Jobs Configuration

Alle cron jobs kræver `CRON_SECRET` environment variabel sat i Dokploy.

## Environment Variable

```bash
CRON_SECRET=your-secure-random-string-here
```

Generer en sikker secret:
```bash
openssl rand -hex 32
```

---

## Deployment

Cron jobs køres via en dedikeret **cron sidecar container** (`cron/Dockerfile`) der bygges og pushes som `ghcr.io/mahope/timetrack-cron:latest` via GitHub Actions.

### Dokploy Setup

1. Opret en ny **Application** i Dokploy
2. Sæt image til `ghcr.io/mahope/timetrack-cron:latest`
3. Tilføj environment variables:
   - `CRON_SECRET` = samme værdi som i app-servicen
   - `APP_URL` = `https://timetrack.dk`
4. Tilføj GHCR registry credentials (PAT med `read:packages` scope)

---

## Cron Jobs (13 total)

### Compliance forecast (#513)

`compliance-forecast` runs Friday at 06:00 Europe/Copenhagen and checks the
following Monday–Sunday against recorded time and fixed work plans. Each day
gets its own rolling window; the highest projected average is reported, so
hours leaving the reference period later in the week cannot hide an earlier
breach. It uses
the organization's rolling 4/12-month reference period, neutral absence and
the existing 45/48-hour thresholds. Rest below 12 hours warns (below 11 hours
is a projected breach). Disabled rules and self-schedulers are excluded.
The notification bus sends to the employee and their managers, including
Teams when configured, independently of manager digest settings. A successful
weekly forecast is recorded in `org_audit_logs` to suppress repeated runs;
concurrent runs serialize using a PostgreSQL advisory lock. Failed delivery
leaves the forecast retryable; a partial delivery can repeat successful channels
on retry. No schema migration is required.

The forecast follows the engine's ISO-week denominator and the work-plan
module's existing rules for holidays, deviations and whole-day absence.
Open-ended absence is only known through today. The message is advisory and
does not prevent changing a plan or recording time.

### Hvert 5. minut

#### Timer Cleanup

Rydder op i stale timer stopping-intents ældre end 5 minutter.

```bash
*/5 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/timer-cleanup
```

#### Webhook Retry

Forsøger at gensende fejlede webhook deliveries, højst webhookens `retryCount` forsøg per delivery (standard 3).

- **Backoff:** næste forsøg ligger tidligst 1, 5, 30, 120 og derefter 360 min efter forrige fejl (`scheduled_for`). En fejlet levering kan derfor stå urørt i lang tid uden at cron'en er gået i stå.
- **Claim:** hver kørsel tager højst 50 forfaldne leveringer med `FOR UPDATE SKIP LOCKED` og skubber `scheduled_for` 15 min frem som lease, så overlappende kørsler ikke leverer de samme rækker. Leveringerne sendes 5 ad gangen.
- **SSRF-værn:** redirects følges ikke (3xx tæller som fejl), og fejler DNS-opslaget af webhook-URL'en, afvises leveringen. Svar-body læses højst 16 KB inden for timeouten.

```bash
*/5 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/webhook-retry
```

#### Email Sync

Processer email-to-task køen via IMAP. Henter emails og konverterer til opgaver.

```bash
*/5 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/email-sync
```

### Hvert 15. minut

#### Calendar Sync

Synkroniserer Google Calendar for alle brugere med aktiv forbindelse. Implementerer exponential backoff ved fejl.

```bash
*/15 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/calendar-sync
```

#### Invoice Sync

Synkroniserer fakturastatus fra Billy/Dinero regnskabssystemer.

```bash
*/15 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/invoice-sync
```

### Hver time

#### Recurring Time Entries

Genererer tidsregistreringer fra recurring templates.

```bash
0 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/recurring
```

#### Demo Cleanup (demo only, hourly)

Kun for den offentlige demo (`DEMO_MODE=1`, se [demo.md](demo.md)): sletter
demokonti ældre end 24 timer med deres organisation og alle data. På alle
andre instanser er jobbet en no-op, der ikke rører databasen.

```bash
15 * * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/demo-cleanup
```

### Dagligt

#### Prepaid Alerts (kl. 09:00)

Sender advarsler om klippekort med lav saldo eller udløb.

```bash
0 9 * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/prepaid-alerts
45 8 * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/budget-alerts
```

#### Drip Emails (kl. 09:00)

Sender personlige lifecycle/onboarding emails fra Mads. Maks 1 email per bruger per dag. Prioriteret rækkefølge: win-back 60d > win-back 30d > upgrade reminder > klippekort tips > first month stats > AI features > extension tips > need help > getting started. Dedup via sentEmails-tabellen.

```bash
0 9 * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/drip-emails
```

#### Inactivity Check (kl. 10:00)

Sender påmindelser til inaktive brugere (14-29 dage uden aktivitet). 30+ dage håndteres af drip-emails cron.

```bash
0 10 * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/inactivity-check
```

#### Webhook Cleanup (kl. 03:00)

Sletter gamle webhook delivery logs. Succesfulde: 30 dage, fejlede: 90 dage.

```bash
0 3 * * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/webhook-cleanup
```

### Ugentligt (mandag)

#### Weekly Summary (kl. 08:00)

Sender ugentlig opsummering med aktivitet og omsætning.

```bash
0 8 * * 1 curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/weekly-summary
```

#### Unbilled Reminder (kl. 10:00)

Påminder om ufakturerede timer.

```bash
0 10 * * 1 curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/unbilled-reminder
```

### Månedligt (d. 1)

#### Monthly Summary (kl. 09:00)

Sender månedlig opsummering med fakturaer og klippekort-statistik.

```bash
0 9 1 * * curl -sf -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/monthly-summary
```

---

## Oversigt

| Job                                                                                             | Schedule       | Endpoint                        |
| ----------------------------------------------------------------------------------------------- | -------------- | ------------------------------- |
| Timer Cleanup                                                                                   | `*/5 * * * *`  | `/api/cron/timer-cleanup`       |
| Webhook Retry                                                                                   | `*/5 * * * *`  | `/api/cron/webhook-retry`       |
| Email Sync                                                                                      | `*/5 * * * *`  | `/api/cron/email-sync`          |
| Calendar Sync                                                                                   | `*/15 * * * *` | `/api/cron/calendar-sync`       |
| Invoice Sync                                                                                    | `*/15 * * * *` | `/api/cron/invoice-sync`        |
| Recurring                                                                                       | `0 * * * *`    | `/api/cron/recurring`           |
| Demo Cleanup (demo only, hourly)                                                                | `15 * * * *`   | `/api/cron/demo-cleanup`        |
| Planlagte satsændringer                                                                         | `5 0 * * *`    | `/api/cron/scheduled-rates`     |
| Prepaid Alerts                                                                                  | `0 9 * * *`    | `/api/cron/prepaid-alerts`      |
| Budget Alerts                                                                                   | `45 8 * * *`   | `/api/cron/budget-alerts`       |
| Drip Emails                                                                                     | `0 9 * * *`    | `/api/cron/drip-emails`         |
| Inactivity Check                                                                                | `0 10 * * *`   | `/api/cron/inactivity-check`    |
| Webhook Cleanup (+ `timer_events` > 30 dage)                                                    | `0 3 * * *`    | `/api/cron/webhook-cleanup`     |
| Weekly Summary                                                                                  | `0 8 * * 1`    | `/api/cron/weekly-summary`      |
| Unbilled Reminder                                                                               | `0 10 * * 1`   | `/api/cron/unbilled-reminder`   |
| Dækningsgrad-påmindelse (#679)                                                                  | `30 6 * * *`   | `/api/cron/coverage-reminder`   |
| Periodeafslutning (#518)                                                                        | `45 4 * * *`   | `/api/cron/period-closing`      |
| Køb i appen: sikkerhedsnet for tabte butiksnotifikationer (mørk uden `STORE_BILLING_ENABLED=1`) | `15 5 * * *`   | `/api/cron/store-billing-sweep` |
| Monthly Summary                                                                                 | `0 9 1 * *`    | `/api/cron/monthly-summary`     |

Alle endpoints kræver header: `Authorization: Bearer $CRON_SECRET`

---

## Fejlfinding

### Test et endpoint manuelt:

```bash
curl -v -H "Authorization: Bearer $CRON_SECRET" https://timetrack.dk/api/cron/calendar-sync
```

### Forventet response:

```json
{
  "success": true,
  "timestamp": "2026-02-15T12:00:00.000Z",
  "results": { ... }
}
```

### Fejl responses:

- `401 Unauthorized` - Forkert eller manglende CRON_SECRET
- `500 Internal Server Error` - Se server logs for detaljer

### Tjek cron container logs:

```bash
docker logs <cron-container-id> --tail 50
```
