# Changelog

## 2.8.0

En stor oprydning i udvidelsen: færre fejl, der kan koste tid, tydeligere
beskeder og et roligere og mere tilgængeligt design.

**Din tid er mere sikker**
- Hurtig registrering gemmer nu tiden på kunden, også når du ikke har valgt
  et projekt, og kan trække fra kundens klippekort.
- Registreringer uden tidspunkt vises i kalenderen under "Uden tidspunkt" og
  kan rettes og slettes. Historikken kan også åbne en registrering.
- Kalenderen viser hele døgnet, så tid sent om aftenen og om natten kan ses.
  En timer, der kører over midnat, får startdagens dato.
- Sletning og "Kassér timer" beder om en bekræftelse først.
- Opretter du tid i kalenderen, kan den trække fra kundens klippekort.
- Første klik efter at have skrevet en beskrivelse går ikke længere tabt.

**Roligere og tydeligere**
- Timeren blinker ikke længere med en indlæsning hvert halve minut, og det,
  du skriver, bliver stående.
- Fejl vises som en besked over timeren, der stadig kan bruges. Uden
  forbindelse står der "Ingen forbindelse. Prøv igen.".
- Er du logget ud på serveren, viser udvidelsen login med en forklaring.
- Kan data ikke hentes, står der det, i stedet for en tom liste.
- "Kopier" i historikken og genvejen til Hurtig registrering åbner nu en
  udfyldt formular. Alt+Shift+S hedder "Pause/genoptag timer", og
  genvejene står i indstillingerne.
- Ugens total og dagens timer tæller weekenden og en kørende timer med.
- Forslag ud fra siden forstår æ, ø og å og kan skjules med ét klik.

**Design og tilgængelighed**
- Danske bogstaver og datoer overalt ("I går", "Lørdag", "12. okt."), og
  timer skrives ens alle steder ("7,5 t").
- Kalenderblokke har læsbare farver, og tekst og kanter har nok kontrast,
  også i mørk tilstand.
- Dialoger kan lukkes med Esc, og kalenderen og Gmail-knappen kan bruges
  med tastaturet.
- Ny fane: timeren passer i sit kort, og layoutet virker på smalle skærme.
- Respekterer systemindstillingen for reduceret bevægelse.

**Hurtigere og mere privat**
- Udvidelsen kører ikke længere et script på alle hjemmesider. Kun Gmail
  har en knap.
- Popup og ny fane åbner hurtigere, og baggrunden henter langt sjældnere.
- Firefox: baggrunden stopper ikke længere ved opstart.

## 2.7.0

Udvidelsen har fået TimeTracks nye udseende, så den passer til web-appen.

- Nyt logo og ikon, nye farver og ny skrift i popup'en og på den nye fane, i
  både lys og mørk tilstand.
- Klippekortet vises som huller: de brugte timer er fyldt ud, og dem, der er
  tilbage, står åbne, fx "7 t tilbage af 20". Det gælder i popup'en, når du
  vælger klippekort, og på den nye fane.
- Ikonet i værktøjslinjen skifter, mens timeren kører, så du kan se det uden
  at åbne popup'en. En timer på pause vises med gult badge, og dagens timer
  med gråt.
- Knappen i Gmail hedder nu "Opret opgave" og har de nye farver.

## 2.6.0

Hver timer har nu sin egen identitet hos TimeTrack, så to browsere, en
gammel popup eller web-appen ikke længere kan komme til at ændre hinandens
timere.

- Når du starter en timer, giver TimeTrack den et sessions-id, som
  udvidelsen husker (også når browseren lukker udvidelsen ned). Alle
  ændringer af timeren — pause, genoptag, skift af kunde eller projekt,
  beskrivelse, ekstra minutter og stop — gælder kun netop den timer.
- En start fra én Chrome-profil eller computer kan ikke længere overskrive en
  timer, der allerede kører fra en anden. Udvidelsen viser i stedet den
  kørende timer, så ingen tid går tabt.
- Har du skiftet kunde i en popup, der viste en gammel timer (fx efter at
  timeren var stoppet og startet igen i web-appen), rammer skiftet ikke
  længere den nye timer. Popup'en viser den aktuelle timer med en besked.
- Et stop gemmer tiden på den kunde og det projekt, timeren faktisk stod på i
  stop-øjeblikket — ikke på en ældre kopi i popup'en.
- Samme timer kan aldrig blive til to tidsregistreringer, heller ikke hvis
  gemmet sendes igen fra offline-køen eller en anden enhed gemmer den
  samtidig.
- Skift og pauser venter, mens et stop er i gang fra en anden enhed, i stedet
  for at ændre timeren midt i stoppet.
- "Stop timer" fra en notifikation stopper kun den timer, notifikationen
  handler om — ikke en ny, der er startet et andet sted siden.

## 2.5.2

Udvidelsen holder sig selv opdateret, så en gammel version ikke kan rode i
timeren.

- Udvidelsen fortæller nu TimeTrack, hvilken version den er. Det gør det
  muligt at se, hvem der stadig kører en gammel version, og at stoppe gamle
  versioner med kendte fejl, før de gemmer forkerte data.
- Er versionen for gammel til at gemme tid, får du en tydelig besked
  ("Opdatér TimeTrack-udvidelsen") med et rødt udråbstegn på ikonet og et
  banner i popup'en. Du kan stadig se dine data.
- Udvidelsen beder selv browseren om at hente den nyeste version, når den
  starter, og når TimeTrack siger, at den er for gammel. Er en ny version
  klar, genstarter udvidelsen af sig selv — men først når ingen tid er ved at
  blive gemt.
- Tid i offline-køen bliver liggende, hvis versionen er for gammel, og
  sendes, når udvidelsen er opdateret. Den bliver ikke kasseret.

## 2.5.1

Stabilitet for timeren, når den bruges i flere Chrome-profiler eller på flere
computere på samme tid.

- Ingen dobbelte poster, når serveren svarer langsomt. Svarede serveren ikke
  inden for 8 sekunder, blev stoppet før annulleret, og timeren kørte videre,
  selvom tiden ofte allerede var gemt. Næste stop gemte så den samme session
  én gang til. Nu prøves gemmet igen med den samme nøgle, så serveren aldrig
  gemmer sessionen to gange. Kan det stadig ikke bekræftes, stoppes timeren
  alligevel, og tiden sendes automatisk, når forbindelsen er tilbage.
- Et site-forslag flytter ikke længere en kørende timer til en anden kunde.
  Har timeren kørt i mere end et minut, tilbyder forslaget "Stop & start":
  den nuværende tid gemmes på den rigtige kunde, og en ny timer startes.
- En start fra én browser eller computer overskriver ikke længere en timer,
  der allerede kører fra en anden. Den kørende timer vises i stedet.
- Skift af kunde på en pauset timer starter nu den nye timer efter gemmet
  (før blev den gamle tid gemt, men der blev ikke startet en ny timer).
- Popup'en viser en timer, der er ved at blive stoppet fra en anden enhed,
  som stoppende og ikke som kørende. Ny fane-siden henter timeren igen, når
  du vender tilbage til den.
- Langsomme svar fra serveren bliver nu rapporteret, så vi kan se dem.

## 2.5.0

Ingen auto-pause mere — der spørges om det målte fravær, og tid kan lægges
til i spring på 5 minutter.

Bemærk: 2.4.0 lå kun kort i Chrome Web Store, før 2.5.0 blev indsendt, så
mange brugere springer fra 2.3.0 direkte til 2.5.0. Alt fra 2.4.0 er derfor
gentaget nederst i dette afsnit.

### Inaktivitet

- Timeren pauses ikke længere af almindelig inaktivitet. Extensionen stempler
  i stedet tidspunktet, hvor stilstanden begyndte, og ved tilbagekomst bliver
  du spurgt om det _målte_ fravær: behold tiden, fjern de X minutter, eller
  stop timeren på det tidspunkt maskinen blev forladt. Før blev hele den
  konfigurerede tærskel trukket fra, uanset hvor længe du reelt var væk.
- Skærmlås trækker ikke længere tid fra af sig selv. Ti sekunders lås kunne
  før koste ti minutter.
- Web og extension spørger ikke om det samme to gange — den første klient,
  der ser stemplet, klipper det ud, og den anden får ingenting.
- Som sikkerhedsnet for en glemt timer findes nu en hård auto-pause først
  efter 2 timers stilstand. Den kan slås fra eller ændres i web-appen under
  Indstillinger → Notifikationer, og den håndhæves også af extensionens
  timer-alarm, så den virker med fanen lukket.

### Hurtig tidsregistrering

- Ny række i Timer-fanen med +5, +10, +15 og +30 minutter, som kan stables:
  klik flere gange, og minutterne lægges sammen. Popup'en lukker ikke,
  displayet tæller op med det samme, og knappen kvitterer kort med "+15 min".
  Knapperne vises kun, når der faktisk er en timer at lægge tid til.

### Fejlrettelser

- "Timeren starter forfra" er rettet. Et heartbeat kunne nulstille den
  kørende timer, så baren viste 00:00:00 — og gik adoptionen galt, var tiden
  væk. Serverens svar om en allerede kørende timer behandles nu som brugerens
  egen timer i stedet for at rydde den.
- Hurtig tidsregistrering kan ikke længere skabe en fantom-timer efter et
  stop, og et klik fortryder ikke en pause.

### Med fra 2.4.0 (udgivet 21/9-2026, kort før 2.5.0)

- Start timer direkte på et klippekort fra Klippekort-fanen, med "Kører nu"-
  badge på det kort der tælles ned på.
- Auto-valg af klippekort følger samme udløber-først-regel som web-appen.
- Pauset tid bliver på den kunde den er optjent på, også hvis man skifter
  kunde mens timeren er på pause.
- Genoptag sender den viste tid eksplicit til serveren, så en timer ikke kan
  arve et ældre tidstal.

## 2.4.0

Start tiden direkte på et klippekort — og pauset tid bliver hvor den hører til.

### Klippekort

- Hvert kort i Klippekort-fanen har nu en "Start timer"-knap. Den starter
  timeren på kortets kunde og låser trækket til netop det kort, så man
  slipper for først at vælge kunde og derefter kort. Kører timeren allerede,
  viser fanen "Kører nu" på det kort tiden trækkes fra.
- Auto-valget af kort følger nu præcis samme regel som web-appen: det kort
  der udløber først, bruges op først.

### Fejlrettelser

- Pauset tid bliver på den kunde den er optjent på. Skiftede man kunde mens
  timeren stod på pause, kunne den gamle kundes tid følge med over og lande
  på den næste registrering. Nu gemmes den pausede tid først på den
  oprindelige kunde, og der startes forfra på den nye.
- Et genoptag sender den viste tid eksplicit til serveren, så en timer aldrig
  kan arve et ældre tidstal fra en tidligere session.

## 2.3.0

Registrér tid direkte på klippekort — med vælger og kvittering.

### Klippekort

- Tid registreret i extensionen kan nu lande direkte på kundens klippekort,
  i stedet for at skulle markeres som klippekort inde i web-appen bagefter.
  Kort med auto-træk foreslås automatisk (det der udløber først bruges op
  først), og serveren trækker aldrig uden et eksplicit kort-id.
- Ny klippekort-vælger i både Timer-fanen og hurtig-registrering: vælg
  "Automatisk" (kundens auto-kort), "Intet klippekort", eller et konkret kort
  — også kort uden auto-træk, som ellers aldrig ville blive foreslået.
  Restsaldoen vises for det kort valget lander på.
- Valget i Timer-fanen huskes selvom popup'en lukkes, mens timeren kører.
  Skiftes kunden, nulstilles valget til "Automatisk".
- Kvittering ved gem: "2,5t trukket fra [Kortnavn] — 7,5t tilbage" vises i
  stop-beskeden og efter hurtig-registrering. Løber kortet tørt undervejs,
  siges det tydeligt: "Kortet løb tørt — resten er fakturerbar tid".

### Fejlrettelser

- Notifikationens "Stop timer"-knap gemmer nu tiden som en registrering i
  stedet for at kassere den. Beskeden siger hvad der faktisk skete — fx
  "2,25t er gemt som tidsregistrering", eller tydeligt at intet blev gemt hvis
  timeren manglede kunde/projekt.

## 2.2.0

Tidspunkter på registreringer, inaktivitets-alert + stærkere timer-vagt.

### Inaktivitets-alert

- Ny `idle`-tilladelse: har du været inaktiv (ingen mus/tastatur) længere end
  din tærskel, sættes en kørende timer automatisk på pause, og den inaktive
  tid tælles ikke med. En notifikation med "Genoptag timer"-knap vises.
- Tærsklen indstilles i web-appen under Indstillinger → Notifikationer →
  Inaktivitetsdetektering og deles mellem web og extension.

### Historik

- Registreringer i historikken (popup og ny fane) viser nu hvornår på dagen
  tiden er logget (fx "08:30–10:15") — ligesom i web-appen.
- Timer-registreringer gemmer nu start- og sluttidspunkt, når timeren stoppes
  (både fra popup'en og via notifikations-/genvejsstop). Ældre registreringer
  uden tidspunkter vises fortsat blot med varighed.

### Fejlrettelser

- Vagten mod to samtidige timere (web + extension) håndhæves nu atomisk på
  serveren, så to timere ikke længere kan snige sig forbi hinanden ved at
  starte i præcis samme øjeblik. Genoptagelse af en pauset timer blokeres
  også, hvis en anden flade i mellemtiden har startet en timer.

## 2.1.2

Bedre indstillinger.

### Indstillinger

- Tilføjet et søgefelt øverst, så man hurtigt kan finde en indstilling (skriv
  fx "fane", "badge" eller "api") i stedet for at scrolle hele listen.
- To indstillinger der før var skjulte er nu tilgængelige:
  - "Badge på ikon" — vælg om extension-ikonet viser den aktive timer, dagens
    samlede timer, eller ingenting.
  - "Åbn kalender på" — vælg om kalenderen åbner på i dag eller den sidst viste
    dag.
- Ændrer man badge-indstillingen, opdateres ikonet nu med det samme.

## 2.1.1

Synkronisering af aktive timere + ny fane-forbedringer.

### Fejlrettelser

- Når både extension og web-app (eller flere flader) var åbne, kunne man starte
  en timer på to forskellige projekter samtidig — og nogle gange dobbelt på
  samme kunde. Serveren er nu eneste sandhedskilde: starter man en ny timer,
  mens der allerede kører en på en anden flade, blokeres starten med en tydelig
  besked ("Der kører allerede en timer på … — stop den først") i stedet for at
  tiden registreres to steder. Genoptag/pause af ens egen timer virker som før.
- Sætter man timeren på pause i web-appen, afspejles det nu også i extensionen
  (badge og popup), så en pauset timer ikke fortsætter med at tælle to steder.

### Ny fane

- Slår man "Åbn TimeTrack på nye faner" fra, får man nu en ren, tom fane i
  stedet for en TimeTrack-skærm — så valget reelt holder TimeTrack ude af nye
  faner. En lille, diskret genvej i hjørnet åbner stadig appen eller
  indstillinger.
- Indstillingen er gjort tydeligere i popup'en ("Slå fra for at beholde
  normale, tomme faner").

## 2.1.0

Team-organisation, offline og sikkerhed/robusthed.

### Team-organisationer

- React-query cachen er nu org-bevidst: hver data-forespørgsel inkluderer den
  valgte organisation i sin nøgle og venter på at organisationen er resolvet,
  så multi-org-medlemmer aldrig kortvarigt ser en anden organisations data.
- Organisationsskifteren er tilføjet til ny-fane-siden (ikke kun popup'en), og
  manuel token-login henter nu også organisationslisten.
- Organisationsskift blokeres mens en projekt-/klient-bundet timer kører eller
  er på pause, så tid aldrig forsøges gemt i en organisation hvor projektet
  ikke findes.

### Offline

- Hurtig-registrering og kalender-oprettelse køer nu registreringer lokalt når
  man er offline (i stedet for at fejle og miste dem) og synkroniserer
  automatisk når forbindelsen er tilbage.
- Synkroniseringsstatus opdateres live efterhånden som køen tømmes.
- Timeren kan ikke stoppes offline (kræver server-kontakt) — den fortsætter og
  kan stoppes når man er online igen, med en tydelig besked.

### Fejlrettelser

- Redigering af en registrering nulstiller ikke længere projektet ved åbning.

### Sikkerhed & robusthed

- Token udelades nu fra Sentry-URL'er.
- "Åbn TimeTrack"-links falder tilbage til standarddomænet hvis API-URL'en er
  manipuleret (anti-phishing).
- Content-scriptet kører kun på https-sider.
- Server: skrive-kald fra extensionen er rate-limited pr. token.
- Mindre ydelse: undgår unødige gen-renders hvert sekund i popup'en.

## 2.0.0

- OAuth-login, organisationsskift, kalender, klippekort-status, Gmail-integration.
