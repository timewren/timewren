# Fejlfinding

## Mac: "TimeTrack er beskadiget og bør flyttes til papirkurven"

**Problem**: Ved første åbning på Mac siger macOS at appen er beskadiget. Appen fejler intet — beskeden skyldes at den nuværende version endnu ikke er signeret hos Apple, så macOS' Gatekeeper blokerer den.

**Løsning** (tager under et minut):
1. Træk `TimeTrack.app` fra .dmg'en til mappen **Programmer** som normalt
2. Åbn **Terminal** (tryk Cmd+Mellemrum, skriv "Terminal", tryk Enter)
3. Indsæt denne kommando og tryk Enter:
   ```
   xattr -cr /Applications/TimeTrack.app
   ```
4. Åbn TimeTrack fra Programmer-mappen — nu starter den normalt

Kommandoen fjerner macOS' karantæne-markering fra appen. Det skal kun gøres én gang; opdateringer fremover påvirkes ikke. En kommende version bliver signeret og notariseret hos Apple, hvorefter dette trin ikke længere er nødvendigt.

## Appen starter ikke

**Problem**: TimeTrack Desktop åbner ikke eller lukker med det samme.

**Løsninger**:
1. Genstart computeren og prøv igen
2. Tjek at appen ikke allerede kører i system tray (kig i proceslinjen nederst til højre)
3. Prøv at slette databasen og starte forfra: slet mappen `%APPDATA%/dk.timetrack.desktop/` og genstart appen
4. Kontrollér at WebView2 Runtime er installeret (kræves af Tauri): download fra [developer.microsoft.com](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## Auto-tracking virker ikke

**Problem**: Tidslinjen viser ingen aktiviteter.

**Løsninger**:
1. Tjek at tracking ikke er sat på pause (Indstillinger → Tracking)
2. Tjek at det aktive program ikke er på ekskluderingslisten (Indstillinger → Tracking → Ekskluderede apps)
3. Vent mindst 30 sekunder -- aktiviteter grupperes og vises ikke med det samme
4. Tjek at du har skiftet vindue mindst én gang (appen registrerer vinduesskift)

## AI-klassificering fejler

**Problem**: AI'en returnerer fejl eller ingen forslag.

**Løsninger**:
1. Tjek at din API-nøgle er korrekt (Indstillinger → AI)
2. Tjek din internetforbindelse (undtagen Ollama, som kører lokalt)
3. Tjek at du har kredit/saldo hos din AI-provider
4. Prøv en anden provider midlertidigt for at udelukke provider-problemer
5. For Ollama: tjek at Ollama-serveren kører (`ollama list` i terminalen)

**Typiske fejlbeskeder**:
- "Unauthorized" / "401": Forkert API-nøgle
- "Rate limit exceeded" / "429": For mange forespørgsler -- vent lidt og prøv igen
- "Connection refused": Ingen internetforbindelse (eller Ollama kører ikke)

## Sync-problemer

**Problem**: Data synkroniseres ikke med TimeTrack Cloud.

**Løsninger**:
1. Tjek at du er logget ind (Indstillinger → Sync)
2. Tjek din internetforbindelse
3. Klik på sync-ikonet i statusbaren for at udløse manuel sync
4. Log ud og log ind igen (Indstillinger → Sync → Log ud → Log ind)
5. Tjek at dit TimeTrack-abonnement er aktivt

## Fakturaer eksporteres ikke til Billy

**Problem**: Billy-eksport fejler eller opretter ikke fakturaen.

**Løsninger**:
1. Tjek at din Billy API-nøgle er korrekt (Indstillinger)
2. Tjek at klienten eksisterer i Billy (klienten skal matche)
3. Tjek at fakturaen har mindst én linje med beløb
4. Prøv at eksportere som CSV i stedet og importér manuelt i Billy

## Timerne stemmer ikke

**Problem**: Timer eller varigheder ser forkerte ud.

**Løsninger**:
1. Tjek at din computers ur er korrekt (automatisk tidsindstilling i Windows)
2. Vær opmærksom på sommertidsskift -- registreringer omkring kl. 02:00 i marts/oktober kan se mærkelige ud
3. Registreringer der krydser midnat tæller korrekt men vises som én samlet blok

## Appen bruger for meget hukommelse

**Problem**: TimeTrack Desktop bruger mere RAM end forventet.

**Løsninger**:
1. Luk og genåbn appen -- dette frigør ophobet hukommelse
2. Ryd gamle aktiviteter (Indstillinger → Tracking) -- mange tusinde aktiviteter kan tage plads
3. Normal hukommelsesforbrug er 100-200 MB

## Opdateringen virker ikke

**Problem**: Appen opdaterer sig ikke automatisk.

**Løsninger**:
1. Tjek din internetforbindelse
2. Klik på opdateringsbanneret i toppen af appen (hvis det vises)
3. Download den nyeste version manuelt fra [timetrack.dk/desktop](https://timetrack.dk/desktop)

## Yderligere hjælp

Hvis du fortsat oplever problemer:
- Tjek om problemet er kendt på [timetrack.dk](https://timetrack.dk)
- Kontakt support via appen (Indstillinger → Support) eller email
