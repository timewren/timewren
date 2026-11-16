# Modelbaserede timer-tests (Postgres)

`src/lib/timer/__model__/` tester timer-protokollen som et system: flere
simulerede klienter kører tilfældige handlingssekvenser mod de **rigtige**
tRPC-routere (`timerSync`, `extension`, `time`) og en **rigtig** Postgres, og
invarianterne tjekkes direkte i databasen efter hver handling. Fejler en
invariant, krymper [fast-check](https://fast-check.dev/docs/advanced/model-based-testing/)
sekvensen til det mindste modeksempel og skriver seed og path.

| Fil                        | Indhold                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `world.ts`                 | Bruger/kunder/projekter/klippekort/extension-token pr. kørsel, callers, simuleret serverur (kun `Date` er falsk) |
| `sim.ts`                   | Klientmodellerne (web-fane, extension, Expo-app) og invarianterne                                                |
| `timer-protocol.dbtest.ts` | Kommando-generatoren, properties og de kendte fejls modeksempler                                                 |

## Hvad modellen dækker

**Klienter:** web-faner/-enheder (`useTimerSync` + `TimeTrackingBar`:
fresh start, heartbeat med `expectedVersion`, adoption, gem-dialog med
`clientEntryId`, "Fortsæt", offline-køens køede starter), extension-instanser
i version 2.6.0 og 2.5.x (`timerStore`: start/pause/genoptag/skift via
`updateTimerState`, claim → `createTimeEntry` med `saveWithRetry` → confirm,
write-ahead-kø, notifikationens `quickStop`) og Expo-appen
(`timer-service.ts`).

**Fejl:** tabte svar (serveren har committet, klienten ser en netværksfejl og
reagerer som sin rigtige kode), genindlæsning (med `cancelStopOnUnload`),
ur-skævhed (fast forskydning pr. klient), samtidige handlinger fra to klienter
(`Promise.all` mod databasen), tidsspring og `timer-cleanup`-cron'en.

**Invarianter** (efter hver handling):

1. `timer_states.version` går aldrig baglæns.
2. Ingen genopstandelse: en session der er gemt, kører aldrig igen med samme starttid.
3. Én session ⇒ højst én tidspost (samme sessionsstart).
4. Timer tælles aldrig dobbelt: summen af poster ≤ forløbet tid (+ tolerance for ur-skævhed og afrunding).
5. Klippekort: `used_hours = sum(prepaid_usage)`, `remaining = total − used`, og hver post er trukket præcis én gang med sine timer.
6. Ingen række hænger i `stopping` efter oprydningen.
7. Kundeskift kun ved eksplicit brugerhandling — både på den kørende session og på den gemte post.
8. Ingen serverfejl (500/ukendte fejl) på noget kald.
9. Server-udstedte sessioner (docs/architecture/timer-sessions.md): højst én
   aktiv session; en ryddet række bærer ingen session; rækkens session findes
   og er aktiv (eller gemt, mens stoppet bekræftes); én session ⇒ højst én
   post; en gemt session peger på en post der findes.

## Kendte og rettede fejl

Modellen fandt fejlene #783–#788. Hvert mindste modeksempel er en
deterministisk test i `timer-protocol.dbtest.ts`:

- **Rettet i fase 1** (server-udstedte sessioner, server + web):
  "RETTET …"-tests kræver, at alle invarianter holder (K1 web, K3 web, K4b,
  K6, K7 og web-fanernes udgave af K2). Web-modellen i `sim.ts` sender
  `sessionId`/`clientOpId` som `useTimerSync` og har ingen undvigelser længere.
- **Rettet i fase 2 for extensionen (2.6.0):** K2 (to extension-instanser,
  også samtidige starter), K5 (forældet kundeskift/pause) og K6 mellem to
  extension-instanser er "RETTET (fase 2) …"-tests. Extension-modellen
  sender `sessionId`/`clientOpId` som `timerStore` 2.6.0, adopterer serverens
  tilstand ved `sessionMismatch`/`stoppingInProgress`/`startRejected` og har
  ingen undvigelser. Den modellerer også notifikationens `quickStop`
  (`hurtig-stop`).
- **Ældre extension (2.5.x)** er stadig en aktør i modellen (`legacy: true`
  i `ClientSpec`, `extLegacy(...)` i scenarierne, egen property sammen med
  2.6.0 og web), så bagudkompatibiliteten testes. Dens udgaver af K2 og K5
  står som "KENDT FEJL … (extension 2.5.x)" — de forsvinder først, når
  minimumsversionen afviser 2.5.x. Scenarier med en extension køres for
  begge versioner (`EXT_VERSIONS`).
- **Rettet i fase 2 for appen (timetrack-app#18):** K1 mobil (tabt svar på
  `time.create` frigiver ikke claimet — stop-journalen gør stoppet færdigt
  med samme `timerSessionId`), K3 mobil (posten bygges ud fra claimets
  øjebliksbillede) og K5 for appen er "RETTET (fase 2) …"-tests. Appen
  modelleres som `stopTimerOnServer`/`finishStop`/`updateTimerOnServer`;
  journalen afspilles af `tøm-kø`.
- **Ældre app (build 4/5)** er stadig en aktør (`mobilLegacy(...)`, egen
  property med den nye app og web). Dens K1/K3 er rettet på serveren
  (`time.create` gemmer appens post med sessionen i `stopping` og med
  sessionens projekt/kunde) og står som "RETTET K1/K3 mobil (build 5,
  server)". For at de tilfældige properties kan finde **nye** fejl,
  undviger de ældre klienter (app build 5, extension 2.5.x) de øvrige kendte
  fejl (`avoidKnownBugs`); appen undviger stadig K2 (den starter uden
  idempotensnøgle). Når en fejl rettes, bliver dens test rød: vend den til
  `expectHolds`, og fjern undvigelsen.
- "BLANDET …"-tests dækker ældre klienter (uden `sessionId`) side om side med
  den sessionsbevidste web-klient.

## Kør i CI

Jobbet **Timer model tests (Postgres)** i `.github/workflows/ci.yml` starter en
`postgres:18`-service, lægger schemaet ind med `drizzle-kit push --force` og
kører `npm run test:model` med `TT_DB_TESTS=1`. (Migrationskæden kan ikke
køre på en tom database — `0027` forudsætter legacy-tabeller — derfor `push`
som i Unit Tests-jobbet.)

Testene er holdt ude af `npm run test:unit`: filerne hedder `*.dbtest.ts` og
har deres egen config (`vitest.dbtest.config.ts`), og uden `TT_DB_TESTS=1`
springes de over.

## Kør lokalt

Kræver en **kasseret** Postgres — testene opretter brugere og poster, og
cron-oprydningen rører alle rækker i `timer_states`. Brug aldrig en database
med rigtige data.

```bash
# fx en midlertidig klynge uden Docker
initdb -D /tmp/tt-pg -U postgres -A trust
pg_ctl -D /tmp/tt-pg -o "-p 55432" -l /tmp/tt-pg.log start
createdb -p 55432 -U postgres tt_model

export DATABASE_URL=postgresql://postgres@localhost:55432/tt_model
NODE_ENV=production npx drizzle-kit push --force
TT_DB_TESTS=1 npm run test:model
```

Miljøvariabler:

| Variabel                | Standard   | Betydning                                                |
| ----------------------- | ---------- | -------------------------------------------------------- |
| `TT_MODEL_RUNS`         | `150`      | Kørsler pr. property                                     |
| `TT_MODEL_SEED`         | `20261003` | Fast seed (samme sekvenser i CI); `random` udforsker nye |
| `TT_MODEL_PATH`         | –          | Genafspil et modeksempel (sammen med seed)               |
| `TT_MODEL_MAX_COMMANDS` | `30`       | Maks. handlinger pr. sekvens                             |
| `TT_MODEL_DEBUG`        | –          | Filsti: skriv hver kørsels kaldspor dertil               |

Et fejlende modeksempel genafspilles med den seed og path som fast-check
skriver, fx:

```bash
TT_DB_TESTS=1 TT_MODEL_SEED=-2068548814 TT_MODEL_PATH="83:5:4:4:4:4:5:6" \
  npm run test:model -- -t "web-faner"
```

Samtidige handlinger (`samtidig[…]`) kører rigtigt parallelt mod databasen,
så et modeksempel med samtidighed kan kræve et par forsøg at genskabe.
