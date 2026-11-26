# Token-API til desktop, udvidelse og mobil

Desktop 1.0 (og senere mobil) bruger samme tRPC-API som browserudvidelsen
(`extension.*`, spec D9), udvidet med under-namespaces. Kode:
`src/lib/trpc/routers/ext/`. De ældre flade procedurer
(`extension.getTimerState`, `extension.createTimeEntry` …) og
`/api/desktop/*` er uændrede.

## Auth og org

- Alle procedurer tager `token` (extension-token) og valgfrit
  `organizationId` i input. Ruter uden tRPC (SSE, PDF) tager
  `Authorization: Bearer <token>` og `?organizationId=`.
- Tokenet kan også sendes som `Authorization: Bearer <token>` på tRPC-kald
  i stedet for i input. Det anbefales til queries: de er GET, så et token
  i input står i `?input=…` og dermed i proxy- og adgangslogs. Det gælder
  alle `extension.<område>.*` og de flade queries (`validateToken`,
  `listOrganizations`, `getTimerState`, `getTimerStateWithVersion`,
  `getProjectsAndClients`, `matchUrlToProject`, `getUrlPatterns`,
  `getIdleSettings`, `getRecentEntries`, `getTimeEntries`,
  `getPrepaidPackages`). Et token i input vinder over headeren, så
  udvidelsen virker uændret. Uden token begge steder: `UNAUTHORIZED`.
  `organizationId` sendes stadig i input.
- `organizationId` skal være en org, brugeren er medlem af, ellers
  `FORBIDDEN` (ingen stille fallback, så en offline-kø aldrig skriver i en
  forkert org). Uden `organizationId`: den org, der blev valgt ved
  enheds-login, ellers primær-orgen.
- `deviceProcedure` kalder web's egne procedurer med en syntetisk session
  (samme mønster som REST v1 og MCP). Derfor gælder præcis web's grænser:
  moduler, abonnement, Gratis-medlemslås, rolle
  og Gratis' 3 aktive kunder (fakturering og klippekort er åbne på alle planer).
  Fejlbeskederne er web's.
- Skrivninger er begrænset til 120 pr. minut pr. token.
- Transport: tRPC over HTTP med superjson (som udvidelsen). Felter med
  `z.date()` i web's input (fx opgavers `deadline`) skal sendes som
  superjson-datoer.

## Enheds-login

Forløbet står i `src/lib/device-login.ts`:

1. Appen laver `state` (mindst 32 tilfældige URL-sikre tegn), en PKCE
   `code_verifier` (43-128 tegn) og `code_challenge =
   base64url(sha256(verifier))`, og åbner
   `/auth/device?state=…&challenge=…&device_id=…&device_name=…&os=…&kind=desktop&redirect_uri=timewren://auth/callback` (valgfri; kun `timetrack://`, `timewren://` og instansens egne app-schemes, ellers instansens brand).
2. Brugeren godkender (og vælger org). Browseren sendes til
   `timetrack://auth/callback?code=…&state=…` (`timewren://…` for TimeWren). Koden gælder 5 minutter og
   én gang.
3. Appen afviser callbacks, hvis `state` ikke er dens egen, og kalder
   `extension.device.exchangeCode({ code, codeVerifier, state, deviceId })`
   → `{ accessToken, refreshToken, expiresAt, refreshExpiresAt,
   organizationId, user }`. Adgangstokenet gælder 30 dage, refresh 180.
4. `extension.device.refresh({ refreshToken, deviceId })` roterer begge.
   Går svaret tabt, kan appen prøve igen med det gamle refresh-token
   inden for 60 sekunder efter rotationen. Det giver ét nyt par, og parret
   fra det tabte svar holder op med at virke. Bruges et roteret
   refresh-token igen senere, tilbagekaldes sessionen (tegn på et stjålet
   token), og brugeren skal logge ind igen. Appen skal derfor gemme de nye
   tokens, før den bruger dem, og kun have én fornyelse i gang ad gangen.
   Svaret giver altid en org, brugeren stadig er medlem af.
5. `extension.device.logout({ token })` tilbagekalder enheden. Brugeren kan
   også tilbagekalde den i web under Indstillinger → Integrationer.

Nyt login fra samme `device_id` tilbagekalder enhedens tidligere tokens.

## Procedurer

| Område         | Procedurer                                                                                                                                                                                                                     | Web-procedure bagved                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `entitlements` | `get`                                                                                                                                                                                                                          | `subscription.getDetails`, moduler, rolle-adgang                                                                                               |
| `clients`      | `list`, `get`, `create`, `update`, `archive`, `unarchive`                                                                                                                                                                      | `clients.*` (inkl. `domains`)                                                                                                                  |
| `cvr`          | `lookup`, `search`                                                                                                                                                                                                             | `integrations.cvrLookup`, `integrations.cvrSuggest` (CVR-tjenesten med cvrapi.dk som fallback; kun læsninger, web's CVR-rate limit pr. bruger) |
| `projects`     | `list`, `get`, `create`, `update`, `setStatus`, `archive`, `monthlyBudget`                                                                                                                                                     | `projects.*` (`archive` = `projects.delete`, status "archived")                                                                                |
| `entries`      | `list`, `get`, `create`, `update`, `delete`                                                                                                                                                                                    | `time.*` (timepris-hierarki, klippekort, `clientEntryId`)                                                                                      |
| `tasks`        | `list`, `get`, `statuses` (baner med `category`), `create`, `update`, `setStatus`, `move` (til en egen bane, kategorien sætter `status`), `reopen`, `timeEntries`, `logTime`, `delete`, `createSubtask`, `setAssignee`          | `tasks.*`, `taskStatuses.listForContext`, `time.create` med `taskId`                                                                           |
| `invoices`     | `list`, `get`, `uninvoicedSummary`, `uninvoicedEntries`, `previewDraft`, `createDraft`, `update`, `lines`, `linesByInvoice`, `saveLines`, `send`, `markPaid`, `exportToBilly`, `exportToDinero`, `exportToEconomic`, `pdfLink`, `totals`, `delete`, `createCreditNote`, `emailStatus` | `invoices.*`, `integrations.exportInvoiceTo*`, `emailActivity.getInvoiceStatus`, `invoicePdfTotals` (som PDF'en) |
| `klippekort`   | `list`, `get`, `create`, `update`, `topUp`, `archive`                                                                                                                                                                          | `prepaid.*` (`topUp` tager `id`)                                                                                                               |
| `reports`      | `get`, `export`                                                                                                                                                                                                                | `reports.getReportData`, `reports.exportReport`                                                                                                |
| `rules`        | `getMatchingRules`, `upsert`, `remove`                                                                                                                                                                                         | egen tabel `device_match_rules`                                                                                                                |
| `siteMappings` | `list`                                                                                                                                                                                                                         | domæne-reglerne i `device_match_rules`                                                                                                         |
| `patterns`     | `list`, `upsert`                                                                                                                                                                                                               | egen tabel `device_learned_patterns`                                                                                                           |
| `timer`        | `setTarget`                                                                                                                                                                                                                    | `extension.updateTimerState` (metadata-skrivning)                                                                                              |
| `import`       | `run`                                                                                                                                                                                                                          | `clients/projects/prepaid/time/invoices.create`                                                                                                |
| `device`       | `exchangeCode`, `refresh`, `logout`, `me`                                                                                                                                                                                      | egne tabeller                                                                                                                                  |
| `integrations` | `status`, `exportOptions`                                                                                                                                                                                                      | `user.getIntegrationStatus`, `integrations.getBilly*`/`getDinero*`/`getEconomic*`                                                              |
| `user`         | `settings`, `updateSettings`                                                                                                                                                                                                   | `user.getProfile`, `user.updateProfile`                                                                                                        |
| `company`      | `get`, `update`                                                                                                                                                                                                                | `onboarding.getCompanyProfile`/`updateCompanyProfile`, `invoiceTemplates.getDefault`                                                           |
| `org`          | `members`                                                                                                                                                                                                                      | `organization.getMembers`                                                                                                                      |

Hvor input hedder `data`, er det web's eget input til procedureren i
højre kolonne (fx `extension.clients.create({ token, data: { name,
defaultHourlyRate, roundingEnabled, … } })`). `update` tager `{ id, data }`.

## CVR-opslag

`extension.cvr.lookup({ cvrNumber })` (NOT_FOUND, hvis nummeret ikke findes)
og `extension.cvr.search({ query, limit? })` (højst 10 forslag, aktive først)
er læsninger, så de hverken tæller i skrivegrænsen eller lægges i offline-køen.
Klienten kalder aldrig CVR-tjenesten selv: `CVR_SERVICE_API_KEY` ligger kun i
web's server-env, og uden den bruger web cvrapi.dk (et navnesøg giver da højst
ét forslag). Opslag bruges til at udfylde en kundes navn, CVR og adresse, aldrig
til markedsføring; tjenestens `reklamebeskyttet`-flag føres derfor ikke med i
svaret, og hverken søgetekst eller resultater logges.

## Idempotensnøgle på create

`clients/projects/tasks/klippekort.create` og `invoices.createDraft` tager
et valgfrit `idempotencyKey` (8-64 tegn, desktop sender en uuid). Samme
nøgle fra samme bruger og org til samme procedure inden for 24 timer
giver det oprindelige objekt (hentet med web's `get`) i stedet for en
dublet. Et samtidigt kald med samme nøgle, mens den første oprettelse
kører, får `CONFLICT`; en fejlet oprettelse frigiver nøglen. Tabellen er
`device_idempotency_keys`. `klippekort.topUp` tager også `idempotencyKey`:
samme nøgle fylder kun timer på én gang, og et gentaget kald svarer med
kortet, som det ser ud nu. `entries.create` og `tasks.logTime` bruger
nøglen som web's `clientEntryId`.

## Intet klippekort

`entries.create` (web's `time.create`) tager `prepaidPackageId: null`
eller `noPrepaid: true`, når brugeren har valgt, at posten ikke skal
trækkes fra et kort. Posten gemmes uden kort, og serveren vælger aldrig
et. Udeladt = som før (der trækkes kun på et angivet `prepaidPackageId`).
Undtagelse: en timer-gemning, der lægges sammen med en allerede gemt post
fra samme session, følger den gemte posts kort.
`noPrepaid: true` sammen med et `prepaidPackageId` giver `BAD_REQUEST`.

## Timeren

Start, pause og stop går gennem de flade `extension.updateTimerState`,
`claimForStop` og `confirmStop`, som nu også bærer `taskId` (input og
svar, også `getTimerStateWithVersion`). En frisk start uden `taskId`
starter uden opgave. `extension.timer.setTarget({ sessionId, projectId,
clientId, taskId?, expectedVersion? })` skifter mål på den kørende
eller pausede timer uden at stoppe den: det er updateTimerState's
metadata-skrivning med sessionen som prædikat. `sessionMismatch: true`
(anden eller ingen session) og `stoppingInProgress: true` betyder, at
intet blev skrevet.

`entitlements.get` svarer med plan, grænser + forbrug, moduler, adgang pr.
område og `features` (kan brugeren skrive i området lige nu), så appen kan
vise låste funktioner. Serveren håndhæver uanset.

Fakturaens PDF hentes fra stien i `invoices.pdfLink`
(`/api/ext/invoices/<id>/pdf`) med Bearer-tokenet. Det er web's egen PDF
(samme `buildInvoicePdfProps` og motor), så desktop gemmer den i stedet for
at tegne sin egen i cloud. Ruten har web's vagt (`checkRouteModuleAccess`):
uden org, med fakturering slået fra eller uden læseadgang til
fakturamodulet svarer den 403.

## Desktop som web

Kaldene herunder er tynde videresendelser til web's procedurer med web's
vagter (org, modul, rolle, kundeadgang). Felterne i svarene ændres ikke,
der tilføjes kun.

- `invoices.totals({ id })` → `{ subtotal, vatRate, vatAmount, total,
  showVat, currency }`. Beløb og sats er strenge med to decimaler
  (`"2975.00"`, `"25.00"`). Tallene kommer fra `invoicePdfTotals`, som begge
  PDF-motorer og web's afsendelsesdialog også bruger: moms kun når
  virksomhedsprofilen er momsregistreret (`showVat`), satsen fra fakturaens
  skabelon (ellers standardskabelonen, ellers 25 %), subtotal = linjernes
  sum (ellers fakturaens beløb).
- `invoices.delete({ id })` → `{ success }`. Kun kladder; posterne bliver
  ufakturerede igen.
- `invoices.createCreditNote({ invoiceId, releaseTimeEntries?,
  idempotencyKey? })` → kreditnotaen (fakturarække med `kind:
  "credit_note"` og `relatedInvoiceId`). Gentaget nøgle giver samme
  kreditnota (hentet med `get`).
- `invoices.send({ id, recipientEmail?, expectedRecipient? })`: uden
  `recipientEmail` går mailen til kundens registrerede mail.
  `expectedRecipient` er den kundemail, appen viste; er den ændret i web,
  afvises kaldet med `BAD_REQUEST`, og intet sendes. En anden modtager
  tæller i samme afsendelsesloft som web's send-dialog (60 i timen pr.
  org).
- `invoices.emailStatus({ id })` → `null` eller `{ resendEmailId,
  recipientEmail, latestStatus, sentAt, deliveredAt, openedAt, bouncedAt }`
  for den seneste mail. `latestStatus` er Resend-hændelsen uden `email.`
  (fx sent, delivered, opened, clicked, bounced, complained); ukendte
  værdier skal appen tåle. Fakturamails sendt fra web, før emailStatus kom til, er
  gemt uden org og findes kun, når afsenderen selv slår op, så `null`
  betyder "ingen kendt mail", ikke "aldrig sendt": er fakturaens status
  `sent` eller `paid`, er den sendt. Web's `emailActivity` (liste,
  statistik, forløb og fakturastatus) bruger samme adgang som fakturaen:
  fakturamails kræver læseadgang til fakturamodulet, og et medlem med
  begrænset kundeadgang ser kun mails for sine egne kunder.
- `integrations.status()` → `{ billy, dinero, economic }` (forbundet, som
  web's knapper på fakturaen).
- `integrations.exportOptions({ system })` → `{ products: { id, name }[],
  defaults }` som web's eksport-dialoger. Billy: produkter og `defaults
  { productId, lineType, lineTemplate }`. Dinero: indtægtskonti (`id` er
  kontonummeret som streng) og `defaults { lineType, lineTemplate,
  defaultAccountNumber }`. e-conomic: produkter, `defaults { lineType,
  lineTemplate, defaultLayoutNumber, defaultPaymentTermsNumber }` og
  desuden `layouts` og `paymentTerms`. Ikke forbundet: web's `BAD_REQUEST`.
- `user.settings()` → `{ defaultHourlyRate, roundingEnabled,
  roundingMinutes, roundingMethod, weeklyHourGoal, vatPeriod }`. Uden valgt
  afrunding: 15 minutter, op (web's afrundingshierarki). Uden momsperiode:
  `quarterly` (web's momsoverblik). `user.updateSettings({ data })` er
  web's `user.updateProfile` med samme input (fx `weeklyHourGoal: "37"`).
  `vatPeriod` kan kun læses: updateProfile har ikke feltet, så zod fjerner
  det, og kaldet lykkes uden at ændre momsperioden. Feltet læses samme
  sted, som web's `user.updateCompanyInfo` skriver det, og som web's
  momsoverblik (`vat.getVatOverview`) læser det: org'ens
  virksomhedsprofil, når den findes, ellers brugeren.
- `company.get()` → `{ companyProfile, defaultInvoiceTemplate }` (begge kan
  være `null`; skabelonen også, når rollen ikke har adgang til skabeloner).
  `company.update({ data })` er web's `onboarding.updateCompanyProfile` og
  kræver admin eller ejer. Et sendt `data.vatRegistered` er brugerens valg:
  det gemmes og står siden (`companyProfile.vatRegisteredChosen`). Udelades
  det, og har brugeren aldrig valgt, er fluebenet slået til, præcis når en
  dansk profil har et helt CVR-nummer (`src/lib/invoices/vat-default.ts`).
- `tasks.delete({ id })` sletter opgaven og dens underopgaver.
  `tasks.createSubtask({ parentTaskId, title, description?,
  idempotencyKey? })` finder forælderen i org'en (ikke kun egne opgaver)
  og arver projekt, kunde og prioritet. `tasks.setAssignee({ id,
  assignedToUserId })` tager et medlem af org'en eller `null`.
- `org.members()` → `{ userId, name, email, image, role }[]` for kaldets
  org. `device.me()` → `{ user: { id, name, email }, organizationId }`.

### Næste runde

Ikke bygget endnu (PARITET-WEB afsnit 9, punkt 11-13):

- `taskComments.{list,create,update,delete}` (kræver `taskComments` i
  `web-router-shape.ts`).
- `taskStatuses.{create,update,reorder,delete}`.
- `recurringInvoices.{list,create,update,setPaused,delete}` og
  `invoiceTemplates.{list,getDefault}`.

## Regler og mønstre

`rules.getMatchingRules({ since? })` giver aktive projekters `urlPatterns`
og brugerens bekræftede regler (`kind`: domain, url, repo, app, title →
projekt og/eller kunde). Med `since` (serverTime fra sidste svar) kun
ændringer, inkl. fjernede regler (`deletedAt`). Svaret går 60 sekunder
bag `since`, så en regel kan komme igen; upsert den efter `id`. `upsert` er idempotent pr.
bruger, org, type og mønster; domæner gemmes uden store bogstaver og
"www.". `notWork: true` er en regel uden projekt og kunde ("ikke
arbejde"). Matchningen sker i appen; rå aktivitet sendes aldrig (D3).

`notWork`-regler kommer kun med i `getMatchingRules`, når klienten
forstår dem: klient-headeren `x-timetrack-client: desktop/…` eller
`includeNotWork: true` i input. Andre klienter (udvidelsen) får svaret som
før uden dem; i et delta (`since`) sendes en notWork-regel til dem som
fjernet (`deletedAt` sat), så en regel, der skiftede til "ikke arbejde",
forsvinder fra klienten.

`siteMappings.list` giver udvidelsens site-koblinger (`{ domain,
projectId, clientId, usageCount, lastUsed }`) ud fra domæne-reglerne;
de skrives med `rules.upsert` (`kind: "domain"`).

`patterns.list({ since? })` / `patterns.upsert({ patterns })` gemmer
tt-matchers `LearnedPattern` (`{ key, votes }`) pr. bruger og org.
Serveren fletter ikke: den gemmer det sidst sendte pr. nøgle, og
klienten fletter før den sender.

## Live-strøm

`GET /api/ext/stream` (SSE). 503, når realtime er slået fra: så poller
appen. Hændelser indeholder aldrig forretningsdata:

```
id: 7
event: timer
data: {"type":"timer","event":"stopped","version":42}

id: 8
event: data
data: {"type":"data","entities":["entries","klippekort","invoices"]}
```

`entities`: timer, entries, clients, projects, klippekort, invoices,
tasks, rules. `ping` kommer hvert 25. sekund; to manglende ping = død
strøm. Tilbagekaldes tokenet, eller mister brugeren medlemskabet af
org'en, sendes `event: revoked`, og strømmen lukkes. Kollegers timer
sendes ikke; org-delte ændringer (kunder, projekter, klippekort) gør.

## Import lokal → cloud

`import.run({ dryRun, clients, projects, prepaidPackages, tasks, entries,
rules, invoices })`. `dryRun` er `true` som standard, så kun et kald med
`dryRun: false` opretter noget. En rigtig import kører én ad gangen pr.
bruger og org; et samtidigt kald får `CONFLICT`. Hvert element har `localId`, web's create-input i `data` og
lokale referencer (`clientLocalId`, `projectLocalId`, `prepaidLocalId`,
`entryLocalIds`). Svaret har en rapport pr. entitet (`total`, `created`,
`existing`, `failed`), de første 200 fejl og `ids` (lokalt id → server-id).

- Idempotent: et gentaget kald opretter intet to gange
  (`device_import_map` + afledt `clientEntryId`). Send store databaser i
  bidder: kunder, projekter og klippekort i hvert kald, poster i bidder á
  cirka 500 (1.200 poster tager ca. 45 s).
- Planens grænser er web's. Dry-run forudser dem, inkl. manglende
  virksomhedsprofil før første faktura.
- Fakturaer får nummer fra org'ens serie; det lokale nummer skrives i
  noten. Betalte fakturaer oprettes som sendt og markeres betalt. En
  faktura med `lines` oprettes som kladde, linjerne gemmes med web's
  `saveLines` (linjens `entryLocalId` knytter posten), og den udstedes
  bagefter; linjernes sum skal være `amount`.
- En kreditnota (beløb ≤ 0) med `creditNoteForLocalId` (den originale
  lokale faktura) bliver en rigtig kreditnota via web's
  `createCreditNote`: nummer fra serien, originalens linjer negeret,
  originalen udlignet (betalt). Kun fuld kreditering: beløbet skal være
  originalens med modsat fortegn. Posterne bliver på originalen.
  Kreditnotaer oprettes efter kaldets fakturaer, så rækkefølgen i
  `invoices` er ligegyldig, men originalen skal være importeret (i samme
  eller et tidligere kald). `lines`, status og datoer på kreditnotaen
  bruges ikke.
- Opgaver (`tasks`, via `tasks.create`), poster med `taskLocalId` og
  regler (`rules`, også `notWork`) importeres som resten.
- `isArchived` på et klippekort arkiverer det efter kaldets poster. Ved
  import i bidder: send det kun i sidste kald.
