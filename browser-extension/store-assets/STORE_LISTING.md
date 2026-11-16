# Butiksliste: Chrome Web Store, Edge Add-ons og Firefox

Udkast efter `docs/BRAND.md` (rebrand, issue #825 fase 6). Intet er uploadet. Listen
skiftes i samme release som det nye ikon og den nye popup, efter at 2.6.0 er
håndhævet (#800).

Regler, teksten er skrevet efter: ingen emoji, ingen tankestreger, ingen
udråbstegn, "kunde" ikke "klient", TimeTrack i tredje person og Mads i jeg-form,
konkrete tal i stedet for "effektiv" og "ubesværet".

## Navn

TimeTrack - Tidsregistrering

(Uændret i `manifest.json`. Forslag til en senere release: "TimeTrack:
tidsregistrering med klippekort". Et navneskift i butikken bør tages med Mads først.)

## Kort beskrivelse

Maks. 132 tegn.

**Dansk** (110 tegn)

> Start timeren fra browseren, og se hvor mange timer der er tilbage på kundens klippekort. Til TimeTrack-konti.

**English** (108 tegn)

> Start a timer from your browser and see how many hours are left on the client's prepaid card. For TimeTrack.

## Detaljeret beskrivelse

### Dansk

Hvor mange timer har kunden tilbage? Med TimeTrack i browseren starter du timeren på kunden med ét klik, og klippekortet står lige under: 7 t tilbage af 20, vist som huller, der bliver fyldt, efterhånden som timerne bruges.

TimeTrack er tidsregistrering til selvstændige og små bureauer i Danmark. Udvidelsen hænger sammen med din TimeTrack-konto, så timer, du starter her, også står i web-appen, mobilappen og desktop-appen.

**Det kan udvidelsen**

Timer. Start, pause og stop timeren fra popup'en eller med Alt+Shift+S. Du vælger kunde og projekt, og tiden gemmes på kontoen, når du stopper.

Klippekort. Har kunden et klippekort, trækker TimeTrack tiden fra det, når timeren stoppes. Popup'en viser saldoen som det, der er tilbage, og markerer kort med lav saldo, og kort der snart udløber.

Hurtig registrering. Glemte du timeren, skriver du timerne ind bagefter: vælg kunde, skriv 1,5 t, og gem. Alt+Shift+N åbner formularen.

Ny fane. Timeren, dagens timer, ugens kalender og dine klippekort, hver gang du åbner en fane. Kan slås fra i indstillingerne.

Forslag ud fra siden. Står du på en side, der passer til en kunde eller et projekt, foreslår udvidelsen det. Forslaget bygger på navne og domæner, ikke på kunstig intelligens, og kan slås fra.

Påmindelser og inaktivitet. En påmindelse sidst på dagen, hvis du har registreret færre timer end den grænse, du selv har sat, og et spørgsmål, hvis du har været væk fra computeren, mens timeren kørte.

Offline. Mister du forbindelsen, gemmes registreringen lokalt og sendes, når du er online igen. Den gemmes kun én gang.

Lys og mørk tilstand. Følger systemets tema, eller vælg selv.

**Det kræver udvidelsen**

En TimeTrack-konto. Du kan oprette en gratis på timetrack.dk, uden betalingskort.

**Hvem står bag**

Mads Holst Jensen bygger og driver TimeTrack fra Danmark og svarer selv på support. Skriv til support@timetrack.dk.

### English

How many hours does the client have left? With TimeTrack in your browser you start the timer on a client with one click, and the prepaid card sits right below it: 7 h left of 20, shown as holes that fill up as the hours are used.

TimeTrack is time tracking for freelancers and small agencies in Denmark. The extension works with your TimeTrack account, so a timer you start here also shows up in the web app, the mobile app and the desktop app.

**What the extension does**

Timer. Start, pause and stop the timer from the popup or with Alt+Shift+S. Pick a client and project, and the time is saved to your account when you stop.

Prepaid cards. If the client has a prepaid card ("klippekort"), TimeTrack deducts the time from it when the timer stops. The popup shows the balance as what is left and marks cards with a low balance and cards that expire soon.

Quick entry. Forgot the timer? Enter the hours afterwards: pick a client, type 1.5 h and save. Alt+Shift+N opens the form.

New tab. The timer, today's hours, this week's calendar and your prepaid cards every time you open a tab. Can be turned off in the settings.

Suggestions from the page. When you are on a page that matches a client or project, the extension suggests it. Suggestions are based on names and domains, not on AI, and can be turned off.

Reminders and idle time. A reminder late in the day if you have logged fewer hours than the limit you set, and a question if you were away from the computer while the timer was running.

Offline. If the connection drops, the entry is stored locally and sent when you are back online. It is saved only once.

Light and dark mode. Follows your system theme, or pick one yourself.

**What you need**

A TimeTrack account. You can create a free one at timetrack.dk, no credit card needed.

**Who is behind it**

Mads Holst Jensen builds and runs TimeTrack from Denmark and answers support himself. Write to support@timetrack.dk.

## Kategori

Produktivitet (Productivity)

## Sprog

Dansk, engelsk

## Skærmbilleder (1280 × 800)

Genereres med `node scripts/store-assets.mjs` til `store-assets/screenshots/`.
Alle data i billederne er opdigtede ("Bageriet på hjørnet", "Cykelværkstedet",
"Arkitektstuen Nord").

1. `1-timer-og-klippekort.png`: Start timeren, og se saldoen
2. `2-klippekort.png`: Alle klippekort ét sted
3. `3-hurtig-registrering.png`: Skriv timer ind bagefter
4. `4-ny-fane.png`: Dagen i en ny fane
5. `5-moerk.png`: Også i mørk tilstand

## Promo-billeder

Genereres til `store-assets/promo/`:

- Lille tile: `promo-440x280.png`
- Stor tile: `promo-920x680.png`
- Marquee: `promo-1400x560.png`

## Øvrige felter

- Hjemmeside: https://timetrack.dk
- Support: support@timetrack.dk
- Privatlivspolitik: https://timetrack.dk/privacy
- Formål (single purpose): Tidsregistrering for TimeTrack-brugere: start og stop en timer, registrer tid og se klippekortets saldo fra browseren.

## Fakta bag teksten

| Påstand                                                   | Kilde                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Alt+Shift+S, Alt+Shift+N                                  | `manifest.json` → `commands`                                                                                                    |
| Klippekort trækkes ved stop, lav saldo og "Udløber snart" | `src/stores/timerStore.ts`, `src/popup/components/tabs/PrepaidTab.tsx`                                                          |
| Ny fane kan slås fra                                      | `src/stores/settingsStore.ts` (`newTabEnabled`)                                                                                 |
| Forslag bygger på navne og domæner                        | `src/utils/smartMatching.ts`                                                                                                    |
| Påmindelse og inaktivitet                                 | `src/background/index.ts` (daglig påmindelse, idle)                                                                             |
| Offline, gemmes kun én gang                               | `src/api/offlineClient.ts` (`clientEntryId`)                                                                                    |
| Gratis konto uden betalingskort                           | `src/lib/billing/plan-gate.ts` (Gratis-planen), samme løfte på `src/app/page.tsx` og `src/app/gratis-tidsregistrering/page.tsx` |
| Billy og Dinero (promo-marquee)                           | `src/lib/integrations/billy.ts`, `dinero.ts`; "Billy og Dinero er live" i `src/app/dashboard/help/page.tsx`                     |
| Lavet i Danmark (promo-marquee)                           | BRAND.md → Personen bag: "bygger og driver TimeTrack fra Danmark"                                                               |
| Support-adresse                                           | `src/app/dashboard/help/page.tsx`                                                                                               |
