# Installér TimeTrack på Mac

Sådan installerer du TimeTrack Desktop på din Mac. Guiden tager under to minutter.

## 1. Hent og installér

1. Download `.dmg`-filen (vælg **Apple Silicon** til M1/M2/M3/M4-Mac, **Intel** til ældre Mac)
2. Åbn `.dmg`-filen og træk **TimeTrack** til mappen **Programmer**

## 2. Første åbning: "Appen er beskadiget"

Når du åbner TimeTrack første gang, kan macOS vise beskeden *"TimeTrack er beskadiget og bør flyttes til papirkurven"*. **Appen fejler ikke noget** — den nuværende version er blot endnu ikke signeret hos Apple, og derfor blokerer macOS den som en sikkerhedsforanstaltning.

Sådan låser du den op (skal kun gøres én gang):

1. Åbn **Terminal**: tryk `Cmd + Mellemrum`, skriv `Terminal`, tryk `Enter`
2. Kopiér denne linje ind i Terminal og tryk `Enter`:

   ```
   xattr -cr /Applications/TimeTrack.app
   ```

3. Åbn TimeTrack fra Programmer-mappen — nu starter den normalt

## 3. Giv tilladelser til auto-tracking

For at TimeTrack kan se titlerne på de vinduer du arbejder i (fx hvilket dokument eller hvilken side), skal den have tilladelse til skærmoptagelse — macOS kræver dette for at læse vinduestitler. TimeTrack optager **ikke** din skærm, og aktiviteter forlader aldrig din computer:

1. Gå til **Systemindstillinger → Anonymitet & sikkerhed → Skærm- og systemlydoptagelse**
2. Slå **TimeTrack** til (tilføj den med `+` hvis den ikke står på listen)
3. Genstart TimeTrack

Uden tilladelsen kører TimeTrack stadig, men kan kun se programnavne (fx "Safari"), ikke hvad du arbejder på i programmet.

## Hjælp

Virker noget ikke? Skriv til support — så hjælper vi med det samme.
