# Oversættelsesnoter: pl

Maskinelt udkast fra Claude (6/11-2026), ikke læst af en indfødt. Katalog: `src/i18n/messages/pl/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/pl/` (564), Chrome: `_locales/pl/` (5).

## Valg

- Tiltale: uformel "ty" med imperativ og små bogstaver ("twój"). Kønnede former undgås med bezosobowe former ("Nie zalogowano", "Nie było Cię"). Enkelte steder står dog "(a)", fx "zmienił(a)" når en navngiven person er subjekt.
- Kundevendte tekster (`pdf.*`, `emailsBilling.*`, `portal.*`, kundemails): "Państwo" eller upersonlig form. Hilsner er "Dzień dobry, {name}," (ikke "Szanowny/Szanowna").
- **Klippekort = "pakiet godzin"**.
- Faste termer: rejestracja czasu, wpis czasu, karta czasu, faktura, faktura korygująca, stawka godzinowa, wskaźnik wykorzystania, ewidencja przebiegu, pracownik, zamknięcie okresu, portal klienta, stoper, abonament (retainer), subskrypcja.
- Plural: `one`, `few`, `many`, `other` i alle plural-blokke. Hvor kilden ikke har plural, er tal ofte sat efter kolon ("Wpisy: {count}") for at undgå kongruensfejl.
- Anførselstegn er polske („…”). Intervaller er skrevet "od … do …".

## Usikre termer

- Lane (kanban): "kolumna" (kolliderer med tabelkolonner). Alternativ "tor".
- "Clip" i klippekort: "jednostka rozliczeniowa" / "porcja" / "krok" (varierer pr. navneområde, bør ensrettes). "Hole": "dziurka".
- Impersonation: "Podszywanie" (alternativ "Przejęcie sesji"). Broadcast: "komunikat".
- Dansk reg.nr.: "Nr oddziału (reg.)". Fixed holiday: "Wspólny urlop".
- `clients.openInvoices.countOne/countOther`: "faktura"/"faktur"; giver forkert pluralform ved 2-4, hvis koden bruger dem med tal. Bør laves om til ICU-plural.
- Nøgler uden plural men med `{days}`/`{count}` + navneord står som "dni" (ukorrekt ved 1 og 22-24) i `expiry.inDays` m.fl.
- `tasks.deleteLane.noDestination`/`moveWhere`: `<b>` er flyttet omkring hele plural-blokken.
- `serverExports`, `enterpriseTimesheet.csvHeader`: CSV-kolonner er oversat; filnavne og "Ja/Nej" er bevaret. `projects.list.csvFilePrefix` er oversat til "projekty".
- Lovtekster (arbejdstidsloven L68) er uofficielle oversættelser.
