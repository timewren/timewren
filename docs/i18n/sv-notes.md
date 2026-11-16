# Svenska (sv): valg og usikre termer

Maskinelt udkast fra Claude (en → sv, da som kontrol). Kræver gennemlæsning af en indfødt, før nøglerne godkendes.

## Valg

- Tiltale: "du" i produkt-UI. Kundevendte tekster (`pdf.*`, `emailsBilling.*`, `portal.*`) bruger neutral eller upersonlig form.
- **klippekort = "timbank"** (flertal "timbanker"). "Klippkort" findes i svensk, men betyder normalt rabatkort til transport eller træning og siger intet om forudbetalte timer. "Timbank" er den etablerede betegnelse for forudbetalte konsulenttimer.
- Timer skrives "tim" i løbende tekst, minutter "min" (ikke "m", som betyder meter). Kodefelterne (`h`, `m`) er uændrede.
- Debiteringsgrad = utilisation rate (`Debiteringsgrad`); "Täckningsgrad" bruges, hvor den danske kilde siger dækningsgrad (`coverage`).
- Kreditnota = "kreditfaktura". Periodeopgørelse ("statement") = "sammanställning".
- CSV-overskrifter og eksportfilnavne er oversat som i de/es (`enterpriseTimesheet.csvHeader`, `csvFile`). Filformat-tokens i `serverExports.readme` og import-kolonner (`navn`, `email`, `dato`, `timer`, `medarbejder/leder/admin`) er uændrede, fordi de er format.
- Danske opgavetekster i hurtigindtastning (`tasks.quickAdd.*`) står på dansk, fordi tolken kun forstår dansk.

## Usikre termer

- `activity.action.m/f/p.*`: passiv ("skapades") i alle tre køn, fordi en/ett ikke passer til koden.
- `closure.*` (faste ferieuger): "Stängningsvecka".
- `onboarding`/`pdf`: reg.nr. som "Clearingnummer", kontonr. som "Kontonummer".
- `enterpriseComponents.workPlan.legal.*`: dansk lovtekst oversat med "(Inofficiell översättning)".
- `home.greeting.forenoon` er "God morgon" (som `morning`).
- Ugedage med stort begyndelsesbogstav (`format.weekday.*`, `templates.form.mon..sun`), selv om svensk normalt bruger småt; sætninger i `time.insights` er omformuleret.
- `settingsSecurity.passkeyCount`: "passkey" bevaret.
- `clients.list.bulkDelete.confirmWord` = "TA BORT" (brugeren skal skrive ordet).
- Dato-hint "YYYY-MM-DD" vist som "ÅÅÅÅ-MM-DD" i fejltekster.
