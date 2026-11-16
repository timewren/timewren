# QA Checklist — TimeTrack Pre-Release

Status-legende: `[ ]` = Ikke testet, `[x]` = Bestået, `[!]` = Fejl fundet, `[-]` = Sprunget over

## Teststrategi

### Automatiserede tests (kør først)

```bash
# 1. Type check
npx tsc --noEmit

# 2. Lint
npm run lint

# 3. Unit tests (tRPC routers: clients, time, prepaid, invoices)
npm run test:unit

# 4. E2E tests (159 tests: auth, clients, projects, time, klippekort, dashboard)
npm run dev:setup          # Start Docker + migrate + seed + dev server
npm test                   # Eller: npm run test:headed (med browser synlig)
npm run test:report        # Se HTML-rapport bagefter
```

### Programmatisk testning

**Eksisterende E2E-dækning (Playwright):**
- Auth (20 tests): login, registrering, logout, session, protected routes
- Klienter (24 tests): CRUD, CVR, søg/filtrer, arkivér
- Projekter (25 tests): CRUD, rates, status, søg/filtrer
- Tidsregistrering (23 tests): timer, poster, datoer, klippekort-integration
- Klippekort (23 tests): CRUD, filtrer, balance, status
- Dashboard (44 tests): layout, widgets, navigation, responsivt, mobil

**Eksisterende unit-dækning (Vitest):**
- Klient-router: max 500 limit, arkiv-filtrering, stats-aggregering
- Time-router: rate-hierarki (projekt > klient > global), cache
- Prepaid-router: timefradrag, brøkdele, balance-validering
- Invoice-router: state machine (draft→sent→paid), nummergenerering

**Hvad mangler og bør skrives:**
Se sektionerne nedenfor — tests markeret med `🤖 NY TEST` bør tilføjes.

---

## 1. Autentificering & Sikkerhed

**Eksisterende dækning:** `tests/e2e/auth.spec.ts` (20 tests)

| #    | Feature                 | Metode                                                                  | Status |
| ---- | ----------------------- | ----------------------------------------------------------------------- | ------ |
| 1.1  | Email/password login    | ✅ E2E dækket                                                           | []     |
| 1.2  | Magic link login        | 🖐️ Manuel: kræver email-indbakke                                        | []     |
| 1.3  | Google OAuth            | 🖐️ Manuel: OAuth redirect kræver rigtig Google-konto                    | []     |
| 1.4  | GitHub OAuth            | 🖐️ Manuel: OAuth redirect                                               | []     |
| 1.5  | Discord OAuth           | 🖐️ Manuel: OAuth redirect                                               | []     |
| 1.6  | SMS login (MessageBird) | 🖐️ Manuel: kræver rigtig telefon + API-nøgle                            | []     |
| 1.7  | Passkeys                | 🖐️ Manuel: kræver WebAuthn (Playwright kan ikke simulere)               | []     |
| 1.8  | 2FA/TOTP aktivering     | 🤖 NY TEST: Playwright kan generere TOTP-koder med `otpauth` lib        | []     |
| 1.9  | 2FA backup-koder        | 🤖 NY TEST: Gem koder fra setup → brug i login-flow                     | []     |
| 1.10 | Glemt password          | 🤖 NY TEST: Trigger flow → tjek API response (email levering er manuel) | []     |
| 1.11 | Session management      | 🤖 NY TEST: Login → GET /api/auth/sessions → verify session exists      | []     |
| 1.12 | Trusted devices         | 🖐️ Manuel: kræver multi-device                                          | []     |
| 1.13 | Login-notifikation      | 🖐️ Manuel: kræver email                                                 | []     |
| 1.14 | Account linking         | 🖐️ Manuel: kræver OAuth                                                 | []     |
| 1.15 | Session persistence     | ✅ E2E dækket (reload + tabs)                                           | []     |
| 1.16 | Protected routes        | ✅ E2E dækket (redirect til login)                                      | []     |

---

## 2. Onboarding & Tour

**Eksisterende dækning:** Delvist i `dashboard.spec.ts` (Getting Started sektion)

| #   | Feature             | Metode                                                                 | Status |
| --- | ------------------- | ---------------------------------------------------------------------- | ------ |
| 2.1 | Onboarding-modal    | ✅ Delvist E2E (Getting Started)                                       | []     |
| 2.2 | Guided tour starter | 🤖 NY TEST: Registrer ny bruger → tjek `.tour-step` synlighed          | []     |
| 2.3 | Tour skip           | 🤖 NY TEST: Klik "Spring over" → `tourStore.hasCompletedTour === true` | []     |
| 2.4 | Tour sidebar        | 🤖 NY TEST: Under tour → sidebar `w-64` (ikke collapsed)               | []     |

---

## 3. Dashboard

**Eksisterende dækning:** `tests/e2e/dashboard.spec.ts` (44 tests)

### Layout & Navigation

| #   | Feature                           | Metode                                                                            | Status |
| --- | --------------------------------- | --------------------------------------------------------------------------------- | ------ |
| 3.1 | Velkomst med brugernavn           | ✅ E2E dækket                                                                     | []     |
| 3.2 | Korrekt dansk dato                | ✅ E2E dækket                                                                     | []     |
| 3.3 | Widget-skeletons vises hurtigt    | 🤖 NY TEST: `page.goto('/dashboard')` → `expect(skeleton).toBeVisible()` inden 1s | []     |
| 3.4 | Sidebar navigation                | ✅ E2E dækket (8 navigations-tests)                                               | []     |
| 3.5 | Mobil hamburger-menu              | ✅ E2E dækket (4 mobil-tests)                                                     | []     |
| 3.6 | Bruger-menu                       | ✅ E2E dækket (3 tests)                                                           | []     |
| 3.7 | Responsivt (desktop/tablet/mobil) | ✅ E2E dækket (3 viewport-tests)                                                  | []     |

### Widget Edit Mode

| #    | Feature                | Metode                                                                        | Status |
| ---- | ---------------------- | ----------------------------------------------------------------------------- | ------ |
| 3.8  | Rediger dashboard-knap | 🤖 NY TEST: Klik "Rediger Dashboard" → edit-toolbar vises                     | []     |
| 3.9  | Drag-and-drop widgets  | 🖐️ Manuel: Playwright drag er upålidelig med react-grid-layout                | []     |
| 3.10 | Resize widgets         | 🖐️ Manuel: Playwright resize er upålidelig                                    | []     |
| 3.11 | Tilføj widget          | 🤖 NY TEST: Edit mode → "Tilføj Widget" → vælg → ny widget vises              | []     |
| 3.12 | Fjern widget           | 🤖 NY TEST: Edit mode → klik × → widget forsvinder                            | []     |
| 3.13 | Gem layout             | 🤖 NY TEST: Fjern widget → "Gem" → refresh → widget stadig væk                | []     |
| 3.14 | Nulstil layout         | 🤖 NY TEST: Fjern widget → "Nulstil" → bekræft → alle default widgets tilbage | []     |
| 3.15 | Kassér ændringer       | 🤖 NY TEST: Fjern widget → "Afslut" → bekræftelses-dialog vises               | []     |

### Widgets (19 stk)

| #    | Widget                 | Metode                                                           | Status |
| ---- | ---------------------- | ---------------------------------------------------------------- | ------ |
| 3.16 | Stats: Klienter        | ✅ E2E dækket (stat cards)                                       | []     |
| 3.17 | Stats: Projekter       | ✅ E2E dækket                                                    | []     |
| 3.18 | Stats: Timer           | ✅ E2E dækket                                                    | []     |
| 3.19 | Stats: Omsætning       | ✅ E2E dækket                                                    | []     |
| 3.20 | Hurtige Handlinger     | ✅ E2E dækket (6 tests)                                          | []     |
| 3.21 | Kommende Opgaver       | 🤖 NY TEST: Opret opgave med deadline → widget viser den         | []     |
| 3.22 | Overskredne Opgaver    | 🤖 NY TEST: Opret opgave med overskredet deadline → widget viser | []     |
| 3.23 | Email-opgaver          | 🖐️ Manuel: kræver email-integration                              | []     |
| 3.24 | Seneste Aktivitet      | ✅ E2E dækket (sektion + empty state)                            | []     |
| 3.25 | Top Klienter           | 🤖 NY TEST: Opret klient + timer → widget viser klient           | []     |
| 3.26 | Ugentlig Sammenligning | 🤖 NY TEST: Widget renderer uden fejl med seed data              | []     |
| 3.27 | Ugentligt Mål          | 🤖 NY TEST: Sæt ugentligt mål i settings → progressbar vises     | []     |
| 3.28 | Omsætningsprognose     | 🤖 NY TEST: Widget renderer uden fejl                            | []     |
| 3.29 | Projekt Sundhed        | 🤖 NY TEST: Widget renderer uden fejl                            | []     |
| 3.30 | Klippekort Lav Balance | 🤖 NY TEST: Opret klippekort med lav balance → widget viser      | []     |
| 3.31 | Udløbende Klippekort   | 🤖 NY TEST: Opret klippekort med snart udløb → widget viser      | []     |
| 3.32 | Produktivitets Heatmap | 🤖 NY TEST: Widget renderer uden fejl                            | []     |
| 3.33 | Timer pr. dag          | 🤖 NY TEST: Widget renderer + canvas/svg element synligt         | []     |
| 3.34 | Omsætning pr. klient   | 🤖 NY TEST: Widget renderer med korrekt måned (timezone)         | []     |
| 3.35 | Fakturaoverblik        | 🤖 NY TEST: Widget renderer uden fejl                            | []     |
| 3.36 | Månedssammenligning    | 🤖 NY TEST: Widget renderer med korrekte data (timezone)         | []     |
| 3.37 | Ikke-fakturerede timer | 🤖 NY TEST: Opret ubilled tidspost → widget viser beløb          | []     |
| 3.38 | KlippekortAlerts       | 🤖 NY TEST: Alert-banner vises ved lav balance                   | []     |

---

## 4. Timer & Tidsregistrering

**Eksisterende dækning:** `tests/e2e/time-tracking.spec.ts` (23 tests)

| #    | Feature                    | Metode                                                                                    | Status |
| ---- | -------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| 4.1  | Start timer                | ✅ E2E dækket                                                                             | []     |
| 4.2  | Stop timer + gem           | ✅ E2E dækket                                                                             | []     |
| 4.3  | Pause/Resume               | ✅ E2E dækket                                                                             | []     |
| 4.4  | Vælg projekt               | ✅ E2E dækket                                                                             | []     |
| 4.5  | Beskrivelse + autocomplete | 🤖 NY TEST: Skriv i input → autocomplete-dropdown vises                                   | []     |
| 4.6  | Timer recovery dialog      | 🤖 NY TEST: Sæt `timerStore` i localStorage med `isRunning: true` → reload → dialog vises | []     |
| 4.7  | Focus mode (F-tast)        | 🤖 NY TEST: Start timer → `page.keyboard.press('f')` → overlay z-[100] synligt            | []     |
| 4.8  | Focus mode exit (Esc)      | 🤖 NY TEST: I focus mode → `page.keyboard.press('Escape')` → overlay lukker               | []     |
| 4.9  | Focus mode stop            | 🤖 NY TEST: I focus mode → klik "Stop & Gem" → timer stopper                              | []     |
| 4.10 | Manuel tidspostering       | ✅ E2E dækket (entries list)                                                              | []     |
| 4.11 | Tidsliste visning          | ✅ E2E dækket                                                                             | []     |
| 4.12 | Rediger tidspost           | 🤖 NY TEST: Klik post → ændr beskrivelse → gem → opdateret                                | []     |
| 4.13 | Slet tidspost              | ✅ E2E dækket                                                                             | []     |
| 4.14 | Quick Time Entry (Cmd+K)   | 🤖 NY TEST: `Cmd+K` → "Ny tidspostering" → modal åbner                                    | []     |
| 4.15 | Floating timer (mobil)     | 🤖 NY TEST: Viewport 375px → `.floating-timer-button` synlig                              | []     |
| 4.16 | Keyboard T toggle          | 🤖 NY TEST: `page.keyboard.press('t')` → timer starter                                    | []     |
| 4.17 | Billable/non-billable      | ✅ E2E dækket                                                                             | []     |
| 4.18 | Timer idle detection       | 🖐️ Manuel: kræver lang idle-periode                                                       | []     |
| 4.19 | CSV import                 | 🤖 NY TEST: Upload test-CSV → entries oprettes                                            | []     |
| 4.20 | Dagens total i top-bar     | 🤖 NY TEST: Opret tidspost → total opdateres i header                                     | []     |
| 4.21 | HH:MM:SS format            | ✅ E2E dækket                                                                             | []     |
| 4.22 | Klient-mode timer          | ✅ E2E dækket (3 tests)                                                                   | []     |

---

## 5. Klienter

**Eksisterende dækning:** `tests/e2e/clients.spec.ts` (24 tests)

| #    | Feature                    | Metode                                                                     | Status |
| ---- | -------------------------- | -------------------------------------------------------------------------- | ------ |
| 5.1  | Opret klient (alle felter) | ✅ E2E dækket                                                              | []     |
| 5.2  | Opret klient (minimal)     | ✅ E2E dækket                                                              | []     |
| 5.3  | CVR-opslag                 | ✅ E2E dækket (sektion, input, knap)                                       | []     |
| 5.4  | Validering (tomme felter)  | ✅ E2E dækket                                                              | []     |
| 5.5  | Søg/filtrer klienter       | ✅ E2E dækket (5 tests)                                                    | []     |
| 5.6  | Se klient-detaljer         | ✅ E2E dækket                                                              | []     |
| 5.7  | Rediger klient             | ✅ E2E dækket (navigation)                                                 | []     |
| 5.8  | Arkivér klient             | ✅ E2E dækket                                                              | []     |
| 5.9  | Klient-rate                | ✅ E2E dækket (card display)                                               | []     |
| 5.10 | Klient-statistik           | 🤖 NY TEST (unit): Verificér unbilled hours + overdue invoices aggregering | []     |
| 5.11 | Max 500 klienter           | ✅ Unit-test dækket                                                        | []     |

---

## 6. Projekter

**Eksisterende dækning:** `tests/e2e/projects.spec.ts` (25 tests)

| #    | Feature           | Metode                                                      | Status |
| ---- | ----------------- | ----------------------------------------------------------- | ------ |
| 6.1  | Opret (timepris)  | ✅ E2E dækket                                               | []     |
| 6.2  | Opret (fast pris) | ✅ E2E dækket                                               | []     |
| 6.3  | Validering        | ✅ E2E dækket                                               | []     |
| 6.4  | Søg/filtrer       | ✅ E2E dækket (6 tests)                                     | []     |
| 6.5  | Status-filtre     | ✅ E2E dækket (Active/Completed/On Hold)                    | []     |
| 6.6  | Se detaljer       | ✅ E2E dækket                                               | []     |
| 6.7  | Rediger           | ✅ E2E dækket (navigation)                                  | []     |
| 6.8  | Slet              | ✅ E2E dækket                                               | []     |
| 6.9  | URL-patterns      | 🤖 NY TEST: Sæt URL-pattern → verificér i API-response      | []     |
| 6.10 | Rate-hierarki     | ✅ Unit-test dækket (projekt > klient > global)             | []     |
| 6.11 | Rate-historik     | 🤖 NY TEST (unit): Ændr rate → `rateHistory` entry oprettes | []     |

---

## 7. Opgaver (Tasks)

**Eksisterende dækning:** Ingen E2E-tests!

| #    | Feature                 | Metode                                                                   | Status |
| ---- | ----------------------- | ------------------------------------------------------------------------ | ------ |
| 7.1  | Kanban board vises      | 🤖 NY TEST: Navigér → 4 kolonner synlige (Backlog/Todo/In Progress/Done) | []     |
| 7.2  | Opret opgave            | 🤖 NY TEST: Klik "Ny" → udfyld → gem → vises i kolonne                   | []     |
| 7.3  | Drag-and-drop           | 🖐️ Manuel: Playwright drag upålidelig med kanban                         | []     |
| 7.4  | Sæt prioritet           | 🤖 NY TEST: Vælg "Høj" → badge vises                                     | []     |
| 7.5  | Sæt deadline            | 🤖 NY TEST: Vælg dato → vises på kort                                    | []     |
| 7.6  | Sub-tasks               | 🤖 NY TEST: Opret opgave → tilføj underopgave → vises nested             | []     |
| 7.7  | Estimeret tid           | 🤖 NY TEST: Sæt estimat → vis i detaljevisning                           | []     |
| 7.8  | Link til projekt/klient | 🤖 NY TEST: Vælg projekt → tilknytning gemmes                            | []     |
| 7.9  | AI-forslag              | 🖐️ Manuel: kræver OpenAI API-nøgle                                       | []     |
| 7.10 | Filtrering              | 🤖 NY TEST: Filtrer på projekt → kun relevante opgaver vises             | []     |
| 7.11 | Bulk operations         | 🤖 NY TEST: Vælg 2+ opgaver → "Opdater" → status ændres                  | []     |

---

## 8. Klippekort (Prepaid)

**Eksisterende dækning:** `tests/e2e/klippekort.spec.ts` (23 tests) + unit tests

| #    | Feature           | Metode                                                     | Status |
| ---- | ----------------- | ---------------------------------------------------------- | ------ |
| 8.1  | Opret klippekort  | ✅ E2E dækket                                              | []     |
| 8.2  | Balance-visning   | ✅ E2E dækket (remaining hours, progress bar)              | []     |
| 8.3  | Auto-deduktion    | ✅ Unit-test dækket (deduction calculations)               | []     |
| 8.4  | Manuel deduktion  | 🤖 NY TEST: Åbn klippekort → "Træk timer" → balance falder | []     |
| 8.5  | Lav balance alert | ✅ E2E dækket (warning display)                            | []     |
| 8.6  | Udløbs-visning    | ✅ E2E dækket (dates display)                              | []     |
| 8.7  | Detaljevisning    | ✅ E2E dækket                                              | []     |
| 8.8  | Aktivér/deaktivér | ✅ E2E dækket (toggle)                                     | []     |
| 8.9  | Filtrer på klient | ✅ E2E dækket                                              | []     |
| 8.10 | Slet klippekort   | ✅ E2E dækket                                              | []     |
| 8.11 | Brøkdels-timer    | ✅ Unit-test dækket (fractional hours)                     | []     |
| 8.12 | Tom/inaktiv pakke | ✅ Unit-test dækket (edge cases)                           | []     |

---

## 9. Fakturering

**Eksisterende dækning:** Unit tests (state machine, nummergenerering)

| #    | Feature                | Metode                                                             | Status |
| ---- | ---------------------- | ------------------------------------------------------------------ | ------ |
| 9.1  | Opret faktura          | 🤖 NY TEST: Navigér → "Ny faktura" → tilføj linjer → gem           | []     |
| 9.2  | Fra tidsregistreringer | 🤖 NY TEST: Vælg ubilled timer → "Opret faktura" → linjer udfyldes | []     |
| 9.3  | Status: kladde→sendt   | ✅ Unit-test dækket                                                | []     |
| 9.4  | Status: sendt→betalt   | ✅ Unit-test dækket                                                | []     |
| 9.5  | Status: recall         | ✅ Unit-test dækket                                                | []     |
| 9.6  | Ugyldige transitions   | ✅ Unit-test dækket (paid/deleted = final)                         | []     |
| 9.7  | Nummergenerering       | ✅ Unit-test dækket (INV-001 format)                               | []     |
| 9.8  | Beløb (2 decimaler)    | ✅ Unit-test dækket                                                | []     |
| 9.9  | Faktura-email          | 🖐️ Manuel: kræver Resend API-nøgle                                 | []     |
| 9.10 | Faktura-skabeloner     | 🤖 NY TEST: Opret skabelon → brug den ved faktura-oprettelse       | []     |
| 9.11 | Faktura-liste          | 🤖 NY TEST: Navigér → fakturaer vises med status-badges            | []     |
| 9.12 | Faktura-detaljer       | 🤖 NY TEST: Klik faktura → detaljer + linjer vises                 | []     |

---

## 10. Rapporter

**Eksisterende dækning:** Ingen tests!

| #    | Feature              | Metode                                                               | Status |
| ---- | -------------------- | -------------------------------------------------------------------- | ------ |
| 10.1 | Rapportside vises    | 🤖 NY TEST: Navigér → side loader uden fejl                          | []     |
| 10.2 | Datointerval-filter  | 🤖 NY TEST: Vælg interval → data opdateres                           | []     |
| 10.3 | Klient-filter        | 🤖 NY TEST: Vælg klient → kun dens data vises                        | []     |
| 10.4 | Projekt-filter       | 🤖 NY TEST: Vælg projekt → filtrerede resultater                     | []     |
| 10.5 | Fakturerbar opdeling | 🤖 NY TEST: Billable/non-billable totaler vises                      | []     |
| 10.6 | CSV-eksport          | 🤖 NY TEST: Klik "Eksporter" → fil downloades (tjek response header) | []     |
| 10.7 | Timezone-korrekthed  | 🤖 NY TEST (unit): `toLocalDateStr()` bruges i alle dato-beregninger | []     |

---

## 11. Keyboard Shortcuts

**Eksisterende dækning:** Ingen tests!

| #     | Shortcut             | Metode                                                                                 | Status |
| ----- | -------------------- | -------------------------------------------------------------------------------------- | ------ |
| 11.1  | Cmd/Ctrl+K → palette | 🤖 NY TEST: `page.keyboard.press('Control+k')` → `.command-palette` synlig             | []     |
| 11.2  | T → timer toggle     | 🤖 NY TEST: `page.keyboard.press('t')` → timer starter                                 | []     |
| 11.3  | Shift+T → pause      | 🤖 NY TEST: Timer kører → `Shift+t` → pauset                                           | []     |
| 11.4  | F → focus mode       | 🤖 NY TEST: Timer kører → `f` → overlay synligt                                        | []     |
| 11.5  | G → D                | 🤖 NY TEST: `page.keyboard.press('g')` → `page.keyboard.press('d')` → URL = /dashboard | []     |
| 11.6  | G → C                | 🤖 NY TEST: g → c → URL = /dashboard/clients                                           | []     |
| 11.7  | G → P                | 🤖 NY TEST: g → p → URL = /dashboard/projects                                          | []     |
| 11.8  | G → T                | 🤖 NY TEST: g → t → URL = /dashboard/time                                              | []     |
| 11.9  | G → K                | 🤖 NY TEST: g → k → URL = /dashboard/klippekort                                        | []     |
| 11.10 | G → I                | 🤖 NY TEST: g → i → URL = /dashboard/invoices                                          | []     |
| 11.11 | G → R                | 🤖 NY TEST: g → r → URL = /dashboard/reports                                           | []     |
| 11.12 | G → S                | 🤖 NY TEST: g → s → URL = /dashboard/settings                                          | []     |
| 11.13 | N → ny (kontekst)    | 🤖 NY TEST: På /clients → `n` → URL = /clients/new                                     | []     |
| 11.14 | / → søgefelt         | 🤖 NY TEST: `page.keyboard.press('/')` → input er fokuseret                            | []     |
| 11.15 | ? → hjælp            | 🤖 NY TEST: `Shift+/` → shortcuts-modal synlig                                         | []     |
| 11.16 | Esc → luk            | 🤖 NY TEST: Åbn modal → `Escape` → modal lukker                                        | []     |

---

## 12. Indstillinger

**Eksisterende dækning:** Ingen tests!

| #     | Feature                    | Metode                                                                | Status |
| ----- | -------------------------- | --------------------------------------------------------------------- | ------ |
| 12.1  | Profil (navn, email)       | 🤖 NY TEST: Ændr navn → gem → refresh → nyt navn vises                | []     |
| 12.2  | Tema (lys/mørk/system)     | 🤖 NY TEST: Vælg "dark" → `document.documentElement` har `dark` class | []     |
| 12.3  | Global timepris            | 🤖 NY TEST: Sæt pris → gem → refresh → pris bevaret                   | []     |
| 12.4  | Push-notifikationer        | 🖐️ Manuel: kræver browser permission + VAPID-nøgle                    | []     |
| 12.5  | Discord webhook            | 🤖 NY TEST: Udfyld webhook-URL → gem → success toast                  | []     |
| 12.6  | Slack webhook              | 🤖 NY TEST: Udfyld webhook-URL → gem → success toast                  | []     |
| 12.7  | Email-præferencer          | 🤖 NY TEST: Toggle email-typer → gem → verify via API                 | []     |
| 12.8  | IMAP konfiguration         | 🖐️ Manuel: kræver IMAP-server                                         | []     |
| 12.9  | Email-aktivitetslog        | 🤖 NY TEST: Navigér → side loader uden fejl                           | []     |
| 12.10 | Email-skabeloner           | 🤖 NY TEST: Opret skabelon → den vises i listen                       | []     |
| 12.11 | Portal-indstillinger       | 🤖 NY TEST: Sæt branding → gem → verify                               | []     |
| 12.12 | Integrationer (API-nøgler) | 🖐️ Manuel: kræver rigtige API-nøgler                                  | []     |
| 12.13 | AI-indstillinger           | 🤖 NY TEST: Toggle AI features → gem → verify                         | []     |
| 12.14 | GDPR data-eksport          | 🤖 NY TEST: Klik "Eksporter" → tjek at job oprettes                   | []     |
| 12.15 | Abonnement                 | 🖐️ Manuel: kræver Stripe                                              | []     |

---

## 13. Abonnement & Trial

| #    | Feature                | Metode                                                              | Status |
| ---- | ---------------------- | ------------------------------------------------------------------- | ------ |
| 13.1 | Trial-banner (<7 dage) | 🤖 NY TEST: Mock subscription med 3 dage → banner synlig            | []     |
| 13.2 | Trial-wall (udløbet)   | 🤖 NY TEST: Mock expired trial → TrialExpiredWall renderes          | []     |
| 13.3 | Past due banner        | 🤖 NY TEST: Mock past_due → rød banner synlig                       | []     |
| 13.4 | Exempt paths           | 🤖 NY TEST (unit): /settings/subscription tilgængelig trods expired | []     |
| 13.5 | Stripe checkout        | 🖐️ Manuel: kræver Stripe test-nøgle                                 | []     |
| 13.6 | Stripe webhook         | 🖐️ Manuel: kræver `stripe listen --forward-to`                      | []     |

---

## 14. Integrationer

| #     | Feature             | Metode                                                           | Status |
| ----- | ------------------- | ---------------------------------------------------------------- | ------ |
| 14.1  | Import Clockify CSV | 🤖 NY TEST: Upload fixture-CSV → entries oprettes korrekt        | []     |
| 14.2  | Import Toggl CSV    | 🤖 NY TEST: Upload fixture-CSV → entries oprettes                | []     |
| 14.3  | Import Harvest CSV  | 🤖 NY TEST: Upload fixture-CSV → entries oprettes                | []     |
| 14.4  | Import Trello JSON  | 🤖 NY TEST: Upload fixture-JSON → tasks oprettes                 | []     |
| 14.5  | Import Todoist CSV  | 🤖 NY TEST: Upload fixture-CSV → tasks oprettes                  | []     |
| 14.6  | Import Effihub CSV  | 🤖 NY TEST: Upload fixture-CSV (dansk format) → entries oprettes | []     |
| 14.7  | Billy sync          | 🖐️ Manuel: kræver Billy API-nøgle                                | []     |
| 14.8  | Dinero sync         | 🖐️ Manuel: kræver Dinero API-nøgle                               | []     |
| 14.9  | e-conomic sync      | 🖐️ Manuel: kræver e-conomic tokens                               | []     |
| 14.10 | Google Calendar     | 🖐️ Manuel: kræver Google OAuth                                   | []     |

---

## 15. Klient-portal

| #    | Feature            | Metode                                                                 | Status |
| ---- | ------------------ | ---------------------------------------------------------------------- | ------ |
| 15.1 | Token-adgang       | 🤖 NY TEST: Generer token via API → besøg `/portal/t/[token]` → adgang | []     |
| 15.2 | Password-login     | 🤖 NY TEST: Sæt password → login med det → success                     | []     |
| 15.3 | Projekt-oversigt   | 🤖 NY TEST: Portal dashboard → projekter vises                         | []     |
| 15.4 | Faktura-visning    | 🤖 NY TEST: Portal → fakturaer synlige                                 | []     |
| 15.5 | Klippekort-balance | 🤖 NY TEST: Portal → balance vises korrekt                             | []     |
| 15.6 | Branding           | 🤖 NY TEST: Sæt branding farve → portal viser den                      | []     |
| 15.7 | Udløbet token      | 🤖 NY TEST: Token med udløbet dato → afvist                            | []     |
| 15.8 | Rate limiting      | 🤖 NY TEST (unit): 5+ forsøg → blokeret                                | []     |

---

## 16. Email-system

| #    | Feature                   | Metode                                                    | Status |
| ---- | ------------------------- | --------------------------------------------------------- | ------ |
| 16.1 | Email-skabeloner renderes | 🤖 NY TEST (unit): Render alle 29 templates → ingen crash | []     |
| 16.2 | Email-til-opgave          | 🖐️ Manuel: kræver Resend webhook                          | []     |
| 16.3 | Email-threading           | 🖐️ Manuel: kræver inbound email                           | []     |
| 16.4 | Vedhæftninger             | 🖐️ Manuel: kræver inbound email med filer                 | []     |
| 16.5 | Opt-out virker            | 🤖 NY TEST: Sæt opt-out → email sendes ikke               | []     |

---

## 17. PWA & Mobil

| #    | Feature               | Metode                                                                    | Status |
| ---- | --------------------- | ------------------------------------------------------------------------- | ------ |
| 17.1 | Service worker        | 🤖 NY TEST: Tjek at SW registreres (`navigator.serviceWorker.controller`) | []     |
| 17.2 | Offline-side          | 🤖 NY TEST: `page.route('**/*', route => route.abort())` → offline side   | []     |
| 17.3 | Manifest              | 🤖 NY TEST: Fetch `/manifest.json` → valid JSON med ikoner                | []     |
| 17.4 | Mobil bund-nav        | 🤖 NY TEST: Viewport 375px → 5 nav-ikoner synlige i bunden                | []     |
| 17.5 | Responsivt alle sider | 🤖 NY TEST: Loop alle routes → viewport 375px → ingen horizontal scroll   | []     |

---

## 18. Browser Extension

| #    | Feature          | Metode                                                        | Status |
| ---- | ---------------- | ------------------------------------------------------------- | ------ |
| 18.1 | Extension bygger | 🤖 TEST: `cd browser-extension && npm run build` → ingen fejl | []     |
| 18.2 | Popup render     | 🖐️ Manuel: Load extension i Chrome → popup åbner              | []     |
| 18.3 | Timer start/stop | 🖐️ Manuel: Extension popup → play/stop                        | []     |
| 18.4 | Site-mapping     | 🖐️ Manuel: Besøg URL → extension foreslår projekt             | []     |
| 18.5 | New tab          | 🖐️ Manuel: Nyt faneblad → widgets vises                       | []     |
| 18.6 | Synk med webapp  | 🖐️ Manuel: Start timer i extension → vises i webapp           | []     |

---

## 19. Admin

| #    | Feature           | Metode                                                       | Status |
| ---- | ----------------- | ------------------------------------------------------------ | ------ |
| 19.1 | Admin-dashboard   | 🤖 NY TEST: Login som admin → /dashboard/admin → stats vises | []     |
| 19.2 | Bruger-søgning    | 🤖 NY TEST: Søg bruger → resultater vises                    | []     |
| 19.3 | Feature flags     | 🤖 NY TEST: Toggle flag → gem → verify                       | []     |
| 19.4 | Broadcasts        | 🤖 NY TEST: Send besked → success                            | []     |
| 19.5 | Email-logs        | 🤖 NY TEST: Navigér → logs vises                             | []     |
| 19.6 | Cron monitoring   | 🤖 NY TEST: Navigér → cron status vises                      | []     |
| 19.7 | Bruger-suspension | 🖐️ Manuel: Risikabel handling, test kun i staging            | []     |

---

## 20. Cron Jobs

| #     | Job               | Metode                                                               | Status |
| ----- | ----------------- | -------------------------------------------------------------------- | ------ |
| 20.1  | email-sync        | 🖐️ Manuel: kræver IMAP                                               | []     |
| 20.2  | calendar-sync     | 🖐️ Manuel: kræver Google Calendar                                    | []     |
| 20.3  | recurring entries | 🤖 NY TEST: Opret recurring template → trigger cron → entry oprettes | []     |
| 20.4  | timer-cleanup     | 🤖 NY TEST (unit): Gamle timers ryddes op                            | []     |
| 20.5  | webhook-cleanup   | 🤖 NY TEST (unit): Udløbne webhooks slettes                          | []     |
| 20.6  | webhook-retry     | 🤖 NY TEST (unit): Fejlede webhooks genprøves                        | []     |
| 20.7  | data-export       | 🤖 NY TEST: Trigger eksport → fil genereres                          | []     |
| 20.8  | invoice-sync      | 🖐️ Manuel: kræver accounting API-nøgler                              | []     |
| 20.9  | monthly-summary   | 🤖 NY TEST (unit): Email-template renderes med korrekte data         | []     |
| 20.10 | weekly-summary    | 🤖 NY TEST (unit): Email-template renderes med korrekte data         | []     |
| 20.11 | unbilled-reminder | 🤖 NY TEST (unit): Korrekte brugere identificeres                    | []     |
| 20.12 | prepaid-alerts    | 🤖 NY TEST (unit): Lav-balance pakker identificeres                  | []     |
| 20.13 | inactivity-check  | 🤖 NY TEST (unit): Inaktive brugere identificeres korrekt            | []     |
| 20.14 | drip-emails       | 🤖 NY TEST (unit): Korrekte emails vælges baseret på bruger-stage    | []     |
| 20.15 | end-of-day        | 🤖 NY TEST (unit): Daglig opsummering genereres                      | []     |

---

## Opsummering

| Kategori           | Total   | ✅ Dækket    | 🤖 Ny test    | 🖐️ Manuel    |
| ------------------ | ------- | ------------ | ------------- | ------------ |
| Auth & Sikkerhed   | 16      | 4            | 4             | 8            |
| Onboarding         | 4       | 1            | 3             | 0            |
| Dashboard          | 38      | 13           | 23            | 2            |
| Timer & Tid        | 22      | 12           | 9             | 1            |
| Klienter           | 11      | 10           | 1             | 0            |
| Projekter          | 11      | 9            | 2             | 0            |
| Opgaver            | 11      | 0            | 9             | 2            |
| Klippekort         | 12      | 11           | 1             | 0            |
| Fakturering        | 12      | 6            | 5             | 1            |
| Rapporter          | 7       | 0            | 7             | 0            |
| Keyboard Shortcuts | 16      | 0            | 16            | 0            |
| Indstillinger      | 15      | 0            | 10            | 5            |
| Abonnement         | 6       | 0            | 4             | 2            |
| Integrationer      | 10      | 0            | 6             | 4            |
| Klient-portal      | 8       | 0            | 7             | 1            |
| Email-system       | 5       | 0            | 2             | 3            |
| PWA & Mobil        | 5       | 0            | 5             | 0            |
| Browser Extension  | 6       | 0            | 1             | 5            |
| Admin              | 7       | 0            | 5             | 2            |
| Cron Jobs          | 15      | 0            | 10            | 5            |
| **TOTAL**          | **237** | **66 (28%)** | **130 (55%)** | **41 (17%)** |

### Prioriteret rækkefølge for nye tests

1. **Keyboard Shortcuts** (16 tests) — hurtige at skrive, høj bruger-påvirkning
2. **Opgaver/Tasks** (9 tests) — ingen dækning, kritisk feature
3. **Rapporter** (7 tests) — ingen dækning, vigtig for fakturering
4. **Dashboard widgets** (23 tests) — delvist dækket, mange nye widgets
5. **Fakturering E2E** (5 tests) — unit-testet men ingen UI-tests
6. **Klient-portal** (7 tests) — ingen dækning, ekstern-vendt feature
7. **Indstillinger** (10 tests) — ingen dækning
8. **Admin** (5 tests) — ingen dækning
9. **Timer features** (9 tests) — delvist dækket, nye features (focus mode)
10. **PWA** (5 tests) — ingen dækning
