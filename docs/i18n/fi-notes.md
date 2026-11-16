# Suomi (fi): valg og usikre termer

Maskinelt udkast fra Claude (en → fi, da som kontrol). Kræver gennemlæsning af en indfødt, før nøglerne godkendes.

## Valg

- Tiltale: uformelt (sinä), mest imperativ eller upersonlig formulering uden pronomen. Kundevendte tekster (`pdf.*`, `emailsBilling.*`, `portal.*`) bruger upersonlig eller passiv form.
- **klippekort = "tuntipaketti"** (som i browserudvidelsens Chrome-beskrivelse). Alternativ: "tuntikortti".
- Plural: `one`/`other` med partitiv i `other` ("# tuntia"); sætninger der ikke kan bøjes ({type}, {period} i nominativ) er bygget med kolon.
- Faktureringsgrad = "käyttöaste". Kreditnota = "hyvityslasku".
- CSV-overskrifter og eksportfilnavne er oversat som i de/es, med ASCII-filnavne. Filformat-tokens i `serverExports.readme` og import-kolonner (`navn`, `email`, `dato`, `timer`, `medarbejder/leder/admin`) er uændrede.
- Danske opgavetekster i hurtigindtastning (`tasks.quickAdd.*`) står på dansk, fordi tolken kun forstår dansk.
- Helligdage er oversat til finske navne (`sharedLabels.holidays`).

## Usikre termer

- `logbook.*`: siden er en tilstedeværelseslog, så "Työaikaloki" i stedet for "ajopäiväkirja"; "Hukka-aika" for spildtid (alternativ: "Tyhjäkäyntiaika").
- `payroll`: "palkkakoodi" (pay code) mod "palkkalaji" (wage type) valgt ens.
- `overtime_used`: "Vapaa korvauksena" (alternativ: "kompensaatiovapaa").
- `tasks.status.backlog` = "Odottaa", `todo` = "Tehtävä" (kan forveksles med "task"; alternativer: "Jonossa", "Tekemättä").
- `closure.*` = "sulkuviikko"/"sulkujakso" (faste ferieuger).
- Flexjob = "Joustotyö (flexjob)"; dansk lovtekst: "Tanskan työaikalaki (Arbejdstidsloven)".
- passkey = "pääsyavain", dry run = "kuivaajo" (alternativ: "esitarkistus"), lane = "sarake", broadcast = "tiedote".
- `sharedLabels.holidays.whitMonday` ("Toinen helluntaipäivä") og `greatPrayerDay` findes ikke som officielle helligdage i Finland; de er danske.
- `sharedLabels.speech.language`: "suomi" i nominativ, sætningerne omskrevet.
- `time.freetext.missing`/`fillBelow*`: kildens kolon og store/små bogstaver er ændret; kontrollér det samlede resultat i UI'et.
- `clients.list.bulkDelete.confirmWord` = "POISTA".
