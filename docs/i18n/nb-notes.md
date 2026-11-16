# Norsk bokmål (nb): valg og usikre termer

Maskinelt udkast fra Claude (en → nb, da som kontrol). Kræver gennemlæsning af en indfødt, før nøglerne godkendes.

## Valg

- Tiltale: "du" i produkt-UI. Kundevendte tekster (`pdf.*`, `emailsBilling.*`, `portal.*`) bruger neutral eller upersonlig form.
- **klippekort = "klippekort"**. Ordet er almindeligt norsk for et kort med et antal klip eller forudbetalte enheder, og det er også i browserudvidelsens Chrome-beskrivelse ("1 hull = {hours} t"). Alternativ: "timepakke".
- Timer skrives "t", minutter "min" ("{h} t {m} min"). Tidtaker = timer, "tidsoppføring" = time entry.
- Faktureringsgrad = utilisation rate; "dekningsgrad" bruges, hvor den danske kilde siger dækningsgrad.
- "AI" er oversat til "KI" (norsk standard). Ret til "AI" i alle nb-filer, hvis produktet ellers bruger "AI".
- CSV-overskrifter og eksportfilnavne er oversat som i de/es. Filformat-tokens i `serverExports.readme` og import-kolonner (`navn`, `email`, `dato`, `timer`, `medarbejder/leder/admin`) er uændrede.
- Danske opgavetekster i hurtigindtastning (`tasks.quickAdd.*`) står på dansk, fordi tolken kun forstår dansk.

## Usikre termer

- `logbook.*`: siden er en tilstedeværelseslog (ankomst/afgang), ikke en kørebog; "Kjørebok" er brugt efter ordlisten, "Tidslogg" ville være mere naturligt.
- `serverSync.deadlines.*`: Skattestyrelsen/Erhvervsstyrelsen med kort norsk forklaring.
- `time.insights.weekday.*` med stort begyndelsesbogstav (midt i sætninger bliver det forkert på norsk).
- `tags` = "etiketter" (alternativ: "tagger"); `branding` = "profilering"/"visuell profil".
- `pdf.*`/`portal.*`: "Reg.nr." beholdt som dansk bankbegreb; "Å betale", "Til gode".
- "Flexjob" = "Fleksjobb"/"Flexjob" (dansk ordning); "Beskæftigelsesministeriet" uoversat; dansk lovtekst med "(Uoffisiell oversettelse)".
- `enterpriseSettings.closure.*`: "fellesferie" (alternativ: "feriestengning").
- `serverExports.readme.csv`: dato-hint "ÅÅÅÅ-MM-DD TT:MM:SS" afviger fra det faktiske format, hvis koden skriver det bogstaveligt.
- `invoices.recurring.*`: `{periode}`/`{måned}` er skabelonvariabler og bevaret.
