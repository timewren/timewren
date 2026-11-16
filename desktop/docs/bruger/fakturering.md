# Fakturering

## Overblik

TimeTrack Desktop kan generere fakturaudkast baseret på dine tidsregistreringer. Du kan redigere linjerne, eksportere som CSV eller HTML, og sende videre til dit regnskabssystem.

## Opret en faktura

1. Gå til **Fakturaer** i sidebaren
2. Klik **Ny faktura**
3. Vælg klient og datoperiode
4. TimeTrack samler automatisk alle tidsregistreringer for perioden
5. Gennemgå linjerne og klik **Opret**

### Fakturalinjerne

Hver linje viser:
- Beskrivelse (fra tidsregistreringen)
- Antal timer
- Timepris
- Beløb (timer x pris)

## Rediger linjer

Før du eksporterer, kan du tilpasse fakturaen:

- **Ændr beskrivelse**: Klik på beskrivelsen og skriv en ny
- **Juster timer**: Ændr antal timer (fx afrund til nærmeste kvarter)
- **Ændr pris**: Overstyr timeprisen for enkelte linjer
- **Slet linje**: Fjern linjer der ikke skal faktureres
- **Tilføj linje**: Tilføj ekstra linjer manuelt

## Eksport

### CSV-eksport

Klik **Eksportér CSV** for at downloade fakturaen som en CSV-fil. Filen kan åbnes i Excel eller importeres i de fleste regnskabssystemer.

CSV-filen indeholder: beskrivelse, antal, enhed, enhedspris og linjebeløb.

### HTML-eksport

Klik **Eksportér HTML** for at generere en formateret faktura i HTML. Du kan:
- Åbne den i en browser
- Printe den som PDF (Ctrl+P → Gem som PDF)
- Sende den direkte til klienten

HTML-fakturaen er formateret med dansk layout (inkl. CVR-nummer, betalingsbetingelser osv.).

## Billy-integration

Hvis du bruger [Billy](https://www.billy.dk/) til regnskab, kan du eksportere fakturaer direkte.

### Opsætning

1. Gå til **Indstillinger**
2. Find Billy-sektionen
3. Indtast din Billy API-nøgle (findes under Billy → Indstillinger → API)
4. Klik **Gem**

### Eksportér til Billy

1. Åbn en faktura
2. Klik **Eksportér til Billy**
3. Fakturaen oprettes i Billy med alle linjer, klient og beløb
4. Du kan derefter sende fakturaen fra Billy

**Bemærk**: Fakturaen oprettes som kladde i Billy -- du skal selv godkende og sende den.

## Tips

- Gennemgå altid linjerne før eksport -- afrund timer og tjek beskrivelser
- Brug klippekort-funktionen til at holde styr på forudbetalte timer
- Fakturaer gemmes lokalt og kan genåbnes senere
- Sletning af en faktura sletter ikke de underliggende tidsregistreringer
