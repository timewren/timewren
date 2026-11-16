# Oversættelsesnoter: pt (pt-PT)

Maskinelt udkast fra Claude (5-6/11-2026), ikke læst af en indfødt. Katalog: `src/i18n/messages/pt/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/pt/` (564), Chrome: `_locales/pt_PT/` (5; Chrome-koden for pt-PT er `pt_PT`).

## Valg

- Portugisisk fra Portugal, Acordo Ortográfico 1990 (registo, ecrã, ficheiro, utilizador, equipa, definições, palavra-passe, iniciar sessão).
- Tiltale: "tu" (imperativ, "o teu") i produkt-UI og mails til brugeren. Kundevendte tekster (`pdf.*`, `emailsBilling.*`, `portal.*`, kundemails) bruger 3. person eller upersonlig form.
- **Klippekort = "bolsa de horas"**: idiomatisk i Portugal for forudbetalte timer. "Banco de horas" er arbejdsretligt (flex), så den undgås. Kort fanenavn i udvidelsen: "Bolsas".
- Faste termer: registo de horas, fatura, nota de crédito, taxa horária, saldo, colaborador, férias/ausência, fecho de período, palavra-passe, cronómetro. GDPR er "RGPD", moms er "IVA".
- Plural: `one` og `other` (`many` er valgfri i pt).

## Usikre termer

- Lugares (seats), função (rolle), adesão (membership), bolsa (feriepulje i `vacationAdjust`, kan forveksles med "bolsa de horas").
- "1 hole" på klippekortet: "1 furo" (bogstavelig).
- "Reg.nr." (dansk bankregistreringsnummer): "Código de agência" er kun en tilnærmelse.
- "Reported well" (raskmelding): "regresso da baixa". Baixa = sygemelding.
- Danske lovtekster (arbejdstidsloven § 4 b) er uofficielle oversættelser.
- `weekdayOn`-nøgler i `time.suggestions` er skrevet som biord ("aos domingos"); tjek at de passer til sætningen i koden.
- `ext.import.*` kolonnenavne og rolleværdier (navn, email, medarbejder/leder/admin) er bevaret som format.
- Plural-nøgler hvor kilden kun havde `=0`/`other` har fået en tilføjet `one`-gren (fx `integrations.timeops.resEntries`).
