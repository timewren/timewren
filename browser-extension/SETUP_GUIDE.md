# TimeTrack Browser Extension - Setup Guide

Denne guide hjælper dig med at få browser extension op og køre 100%.

## Forudsætninger

- Node.js 18+ installeret
- TimeTrack webapp kørende (enten lokalt eller på timetrack.dk)
- Chrome eller Firefox browser

---

## Del 1: Database Migration

Browser extension kræver to nye database tabeller. Kør migration:

```bash
cd timetrack
npm run db:migrate
```

Dette opretter:
- `extension_tokens` - Gemmer API tokens til extension
- `timer_states` - Synkroniserer timer mellem webapp og extension

**Verificer migration:**
```bash
npm run db:studio
```
Tjek at `extension_tokens` og `timer_states` tabeller eksisterer.

---

## Del 2: Extension-ikoner

Ikonerne genereres af brand-pipelinen i web-repoet ud fra `docs/brand/logo/tt-ikon.svg`
(BRAND.md, afsnittet Logo og Ikoner pr. platform):

```bash
npm run brand:icons   # fra repo-roden; skriver docs/brand/generated/
cp docs/brand/generated/extension/*.png browser-extension/public/icons/
```

Det giver `icon-{16,32,48,128}.png` og `icon-running-{16,32,48,128}.png`. Den sidste
udgave bruges af baggrunden, mens en timer kører (`src/background/badgeManager.ts`).
`public/icons/tt-ikon.svg` og `tt-ikon-moerk.svg` er logoet i popup og ny fane.

---

## Del 3: Konfigurer API URL

### Til lokal udvikling:

API URL er allerede sat til `http://localhost:3000` - ingen ændring nødvendig.

### Til produktion (timetrack.dk):

Rediger `browser-extension/src/api/client.ts` linje 3:
```typescript
const API_URL = "https://timetrack.dk/api/trpc";
```

Og `browser-extension/src/background/index.ts` linje 3:
```typescript
const API_URL = "https://timetrack.dk/api/trpc";
```

**Eller** brug Settings panel i extension til at ændre API URL efter installation.

---

## Del 4: Build Extension

```bash
cd browser-extension

# Installer dependencies
npm install

# Build til Chrome
npm run build

# ELLER build til Firefox
npm run build:firefox
```

Output gemmes i:
- Chrome: `browser-extension/dist/`
- Firefox: `browser-extension/dist-firefox/`

---

## Del 5: Installer i Browser

### Chrome

1. Åbn Chrome og gå til `chrome://extensions/`
2. Slå **"Developer mode"** til (øverst til højre)
3. Klik **"Load unpacked"**
4. Vælg mappen `browser-extension/dist/`
5. Extension vises nu i toolbar

### Firefox

1. Åbn Firefox og gå til `about:debugging#/runtime/this-firefox`
2. Klik **"Load Temporary Add-on..."**
3. Vælg filen `browser-extension/dist-firefox/manifest.json`
4. Extension vises nu i toolbar

**Note:** Firefox temporary add-ons forsvinder når browser lukkes. For permanent installation skal extension signeres via Mozilla.

---

## Del 6: Generer API Token

1. Åbn TimeTrack webapp (http://localhost:3000 eller https://timetrack.dk)
2. Log ind på din konto
3. Gå til **Indstillinger → Integrationer**
4. Find sektionen **"Browser Extension"**
5. Indtast et navn (f.eks. "Min Chrome Extension")
6. Klik **"Generer Token"**
7. **VIGTIGT:** Kopier token med det samme - den vises kun én gang!

---

## Del 7: Log ind i Extension

1. Klik på TimeTrack ikonet i browser toolbar
2. Indsæt din token i feltet
3. Klik **"Log ind"**
4. Du er nu logget ind og kan bruge extension!

---

## Brug af Extension

### Timer

- **Start:** Vælg projekt og klik grøn play-knap
- **Pause:** Klik gul pause-knap
- **Stop & Gem:** Klik rød stop-knap (opretter tidsregistrering)

### Hurtig Tidsregistrering

- Klik "Hurtig tidsregistrering"
- Vælg projekt, indtast timer, tilføj beskrivelse
- Klik "Gem"

### Keyboard Shortcuts

- **Alt+Shift+T:** Åbn extension popup
- **Alt+Shift+S:** Start/stop timer

### Smart Features

- **Site Suggestions:** Extension lærer hvilke projekter du bruger på forskellige websites
- **Klippekort Status:** Se resterende timer på aktive klippekort
- **Offline Support:** Registreringer gemmes lokalt og synkroniseres når online

### Indstillinger

Klik tandhjul-ikonet i header for:
- Toggle notifikationer
- Toggle site-baserede forslag
- Toggle klippekort visning
- Ændre API URL
- Rydde gemte data

---

## Fejlfinding

### "Ugyldigt token" fejl

- Tjek at token er kopieret korrekt (ingen mellemrum)
- Generer en ny token i webapp
- Tjek at token ikke er udløbet eller revoked

### Extension kan ikke forbinde

- Tjek at webapp kører (localhost:3000 eller timetrack.dk)
- Tjek API URL i extension settings
- Tjek browser console for CORS fejl

### Timer synkroniserer ikke

- Tjek internetforbindelse
- Klik "Sync nu" i offline-banneret
- Tjek at token stadig er gyldig

### Ikoner vises ikke

- Verificer at PNG filer eksisterer i `dist/icons/`
- Genbyg extension: `npm run build`

### Chrome: "Errors" badge på extension

1. Gå til `chrome://extensions/`
2. Klik "Errors" på TimeTrack extension
3. Læs fejlbeskeden og fix problemet
4. Klik "Clear all" og reload extension

---

## Udvikling

### Watch mode (auto-rebuild)

```bash
npm run dev
```
Genbygger automatisk ved filændringer. Reload extension i browser efter hver build.

### Test produktion build

```bash
npm run build
```

### Build til begge browsere

```bash
npm run build && npm run build:firefox
```

---

## Næste Skridt: Store Submission

Se `store-assets/STORE_LISTING.md` for:
- Chrome Web Store listing tekst
- Required screenshots og images
- Privacy policy

---

## Support

Problemer? Åbn et issue på GitHub eller kontakt support@timetrack.dk
