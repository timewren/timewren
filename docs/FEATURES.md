# Detaljeret Feature-liste for TimeTrack (timetrack.dk)

> Samlet feature-katalog (freelance + enterprise, roller, indstillinger, PR-referencer): [ENTERPRISE-FEATURES.md](ENTERPRISE-FEATURES.md) — opdatér begge ved hver feature-PR.

## 🎯 MVP - Kritiske Funktioner (Fase 1)

### Kundehåndtering (Customer Management)

- **Aktive kunder liste** - Oversigt over alle aktive kunder med søgning, filtrering og sortering
- **Opret/rediger kunder manuelt** - Formular til at tilføje nye kunder med felter for navn, CVR, kontaktinfo, adresse, betalingsbetingelser
- **Kundearkivering** - Mulighed for at arkivere inaktive kunder så de ikke vises i hovedlisten, men data bevares
- **CVR-opslag integration** - Automatisk udfyldning af kundedata ved indtastning af CVR-nummer via offentlig API
- **Kundedetaljer** - Kundeoversigt med projekter, timer, klippekort, fakturaer og historik
- **Timer i perioden** - Se registrerede timer i alt og pr. projekt, inklusive timer uden projekt. Vælg denne måned (standard), sidste måned, i år, sidste år eller egne datoer. Perioderne følger dansk kalender, og tallene følger kundens rapport og dens afrundingsindstillinger. Rapportens links til tidslisten medtager også projektposter uden en direkte kundetilknytning.

### Timeregistrering (Time Tracking)

- **Indbygget stopur** - Start/stop timer direkte fra opgaver og projekter med realtids visning
- **Påmindelse om glemt timer** - Har stopuret kørt i 10 timer, viser timerbjælken én venlig påmindelse med en knap til at stoppe det (én gang pr. timer)
- **Manuel timeoprettelse** - Tilføj timer manuelt med dato, fra/til tidspunkt, beskrivelse og kunde/projekt
- **Timeoversigt** - Liste over alle registrerede timer med filtrering på dato, kunde, projekt og status
- **Redigering af timer** - Mulighed for at rette i registrerede timer (tidspunkt, beskrivelse, tilknytning)
- **Timer per kunde/projekt** - Grupperet visning af timer fordelt på kunder og projekter
- **Ugentlig/månedlig rapportering** - Automatisk sammenfatning af timer i kalenderperioder

### Klippekort System (Prepaid Hours)

- **Opret klippekort** - Definer klippekort med antal timer, pris, gyldighedsperiode og tilknyt til kunde
- **Klippekort-typer** - Forskellige typer: Engangskort, periodiske (månedlige), bundlede pakker
- **Automatisk klip** - Træk automatisk timer fra klippekort når der registreres tid på tilknyttede projekter
- **Manuel klip-funktion** - Mulighed for at klippe manuelt fra klippekort uden timeregistrering
- **Tilknyt og flyt tid** - Find ufaktureret tid efter projekt og dato. Markér **Vis også tid på andre klippekort** for at flytte tid fra kundens øvrige kort. Bladr mellem resultaterne, og se de valgte timer, den forventede saldo og hvilke timer der flyttes eller kan faktureres uden klippekort.
  Tilknyttet tid bliver på projektet og trækkes fra klippekortets saldo. Ved blokeret overtræk viser dialogen den resterende saldo og den længste postering, saldoen kan dække (trækket beregnes pr. postering og rundes op til hele klip og hundrededele af en time, højst 999,99 t pr. postering), og forklarer, hvor overtræk kan tillades. Hvis saldoen ikke dækker ét klip, viser dialogen også det mindste træk. Listen viser en posterings længde i hundrededele af en time, når den ikke går op i hele minutter.
- **Massehandlinger på Tid** - Flyt valgte tidsposteringer til et projekt, fjern dem fra deres projekter og behold tiden på kunden, eller tilknyt op til 200 posteringer fra samme kunde til et aktivt klippekort. Klippekortets saldo og eventuelt fakturerbart overtræk vises inden bekræftelse. Fakturerede og låste poster kan ikke fjernes fra projektet eller tilknyttes et klippekort. Markeringen ryddes, når perioden eller et filter ændres.
- **Når kortet løber tomt** - Vælg pr. kort, om træk ud over saldoen afvises, føres som overtræk (gæld på kortet) eller faktureres som normal tid. Politikken kan også ændres på et eksisterende kort under Rediger.
- **Klippekort saldo** - Realtids visning af resterende timer på aktive klippekort
- **Udløbshåndtering** - Automatisk markering/sletning af udløbne klippekort med varslinger
- **Klippekort historik** - Log over alle klip med dato, beskrivelse og resterende saldo

### Projektstyring (Project Management)

- **Opret projekter** - Definer projekter med navn, beskrivelse, kunde, budget, deadline og status
- **Projekt-til-kunde tilknytning** - Link projekter til specifikke kunder for korrekt time- og økonomistyring
- **Projektbudget** - Angiv timebudget og se løbende forbrug i forhold til estimat. Projektlisten og projektsiden viser budgetstatus som tekst med brugte og budgetterede timer.
- **Projektstatus** - Workflow med statusser: Ikke startet, I gang, On hold, Afsluttet, Faktureret
- **Projektoversigt** - Dashboard med alle projekter, deres status, timeforbrug og økonomi

### Opgavestyring (Task Management)

- **Opret opgaver** - Definer opgaver med titel, beskrivelse, deadline, prioritet og tilknyt til projekt/kunde
- **Opgave-stopur integration** - Start timer direkte fra opgaver og få automatisk tilknytning
- **Opgavestatus** - Egne kolonner på opgavetavlen (navn, farve, rækkefølge), som hver tæller som ikke startet, i gang, afsluttet eller annulleret
- **Opgavetavle** - Kort med kunde og projekt, manuel rækkefølge i hver kolonne, sortering efter deadline/prioritet/kunde, kolonner kan foldes sammen, og kort kan flyttes med tastaturet
- **Opgaveliste** - Oversigt over alle opgaver med filtrering og sortering
- **Deadline-varsling** - Visuel indikation af kommende og overskredte deadlines

### Tarifhåndtering (Rate Management)

- **Global standardsats** - Definer en standard timepris der bruges som fallback
- **Kundespecifik sats** - Tilsidesæt global sats med kundespecifikke priser
- **Projektspecifik sats** - Tilsidesæt kunde/global sats med projektspecifikke priser (højeste prioritet)
- **Tarif-hierarki** - Klar visning af hvilken sats der anvendes: Projekt → Kunde → Global

## ⭐ Vigtige Funktioner (Fase 2)

### Fakturering & Økonomi

- **Billy.dk integration** - Synkroniser kunder, projekter og send fakturaer direkte til Billy
- **Dinero.dk integration** - Alternativ til Billy med samme funktionalitet
- **Fakturakladde fra timer** - Generer fakturaer automatisk baseret på ikke-fakturerede timer
- **Fakturering af klippekort** - Opret fakturaer for solgte klippekort
- **Fakturering af klippekort-rest** - Fakturer ikke-forbrugte timer på udløbne klippekort (valgfrit)
- **Fakturastatus tracking** - Markér timer/klippekort som faktureret og spor betalingsstatus
- **Kreditnota håndtering** - Opret kreditnotaer for tilbagebetalinger

### Rapportering (Reporting)

- **Omsætningsrapport** - Vis total omsætning fordelt på kunder, projekter og perioder
- **Timefaktureringsrapport** - Oversigt over fakturerede vs. ikke-fakturerede timer
- **Klippekort rapport** - Status på alle aktive klippekort med saldo og forbrug
- **Rapport pr. klippekort** - Gruppér en rapport pr. klippekort (Tilpas → Gruppering). Tid kan ligge på et projekt og samtidig være trukket fra et kort, så tallene pr. kort kan afvige fra tallene pr. projekt. Tid uden kort samles under "Uden klippekort".
- **Projektbudget rapport** - Sammenligning af budgetterede vs. faktiske timer per projekt
- **Handshop rapport** (muligvis "Handler rapport") - Transaktion/handelshistorik
- **PDF/CSV eksport** - Download alle rapporter som PDF eller CSV til videre analyse
- **Kundespecifikke rapporter** - Generer rapporter filtreret på individuelle kunder

### Kundeportal (KundeHUB)

- **Kunde-login system** - Giv kunder personlig adgang til deres data
- **Projektoverblik for kunde** - Vis projektets status, forbrug og dokumenter
- **Timeoversigt for kunde** - Transparens om registrerede timer på kundens projekter
- **Klippekort-saldo for kunde** - Kunder kan se deres klippekort-status i realtid
- **Dokumentdeling** - Del projektfiler, fakturaer og rapporter med kunden
- **Kunde-notifikationer** - Automatiske emails ved projektmilepæle, lav klippekort-saldo, nye fakturaer

## 🤖 AI-funktioner (Fase 1.5 - IMPLEMENTERET!)

### Email-to-Task System

- **Unik email-adresse** - Hver bruger får en personlig `task+{id}@timetrack.dk` adresse
- **AI-parsing** - Automatisk udtræk af titel, beskrivelse, deadline og prioritet fra emails
- **Projekt-kategorisering** - AI gætter relevant projekt baseret på afsender og indhold
- **Privacy-mode** - Valgfri: Behandl emails direkte uden AI-processing

### AI Task Management

- **Smart kategorisering** - Automatisk matching af tasks til projekter og klienter
- **Tidsestimering** - AI foreslår tidsestimat baseret på beskrivelse og historik
- **Prioriteringsforslag** - Daglige/ugentlige AI-forslag til top 3 vigtigste opgaver
- **Keyword-baseret fallback** - Hurtig matching uden AI for simple opgaver

### AI Autonomi-niveauer

- **Foreslå (Anbefalet)** - AI foreslår, du godkender alt
- **Auto (lavrisiko)** - AI håndterer simple opgaver automatisk
- **Manuel** - Deaktiver AI, alt manuelt

### BYOK (Bring Your Own Key)

- **Brug egen API-nøgle** - Understøt egen OpenAI eller Azure OpenAI nøgle
- **Self-hosted LLMs** - Integrer med Ollama, LocalAI eller andre OpenAI-kompatible endpoints
- **Fuld datakontrol** - AI-kald går direkte til din egen provider

## 🔄 Avancerede Funktioner (Fase 3)

### Periodisk & Automatisering

- **Periodiske klippekort** - Automatisk udstedelse af månedlige/årlige klippekort til faste kunder
- **Tilbagevendende opgaver** - Opret opgaver der gentages dagligt, ugentligt eller månedligt
- **Automatiske timeposter** - Regel-baseret oprettelse af timer (fx fast månedlig vedligeholdelse)
- **Automatisk fakturering** - Send fakturaer automatisk på fastlagte datoer for abonnementskunder
- **Påmindelser og varsler** - Automatiske notifikationer ved deadlines, lav klippekort-saldo, manglende timeregistrering

### Integration & Betalinger

- **Betalingsgateway integration** - Lad kunder betale klippekort direkte online (Stripe, Nets, MobilePay)
- **Kunde kan købe klippekort** - Webshop-lignende funktion hvor kunder selv kan købe klippekort
- **Economic integration** - Synkronisering med e-conomic bogføringssystem
- **Webhook support** - Giv eksterne systemer mulighed for at lytte på events i TimeTrack

### Samarbejde & Team

- **Flere brugere per konto** - Tillad flere teammedlemmer med forskellige roller
- **Brugerroller og rettigheder** - Admin, Projektleder, Medarbejder med forskellige adgangsniveauer
- **Interne meddelelser** - Chat/besked-system til kommunikation om kunder og projekter
- **Aktivitetslog** - Fuld historik over hvem der har gjort hvad og hvornår
- **Teammedlem-tildeling** - Tildel specifikke opgaver og projekter til teammedlemmer

### Avanceret Projektstyring

- **Projekt-templates** - Genbrugelige projektskabeloner med foruddefinerede opgaver
- **Farvemarkering** - Visuel kategorisering af projekter med farver
- **Gantt-chart visning** - Tidslinje-baseret projektvisualisering
- **Drag-and-drop planlægning** - Omarranger opgaver visuelt i boards eller kalender
- **Milepæle** - Definer og spor vigtige projektmilepæle
- **Projektbudget-varsling** - Automatisk notifikation når projektbudget er ved at blive overskredet
- **Projekt-afhængigheder** - Marker opgaver der er afhængige af hinanden

### Klippekort Avanceret

- **Bundlede klippekort** - Pakker med forskellige typer timer til forskellige priser
- **Klippekort-deltagelse** - Tillad flere kunder at dele samme klippekort
- **Klippekort-overførsel** - Flyt ubrugte timer mellem klippekort eller kunder
- **Tilbagebetalingsregler** - Automatiske eller manuelle tilbagebetalinger af ubrugte klippekort
- **Klippekort-prisstigninger** - Automatisk prisjustering ved fornyelse af periodiske klippekort

## 📊 Nice-to-Have Funktioner (Fase 4)

### Visuelle & UX Features

- **Dashboard med widgets** - Brugertilpasset oversigt med nøgletal og grafer
- **Kalenderintegration** - Synkroniser opgaver og deadlines med Google Calendar / Outlook
- **Hybrid kalender** - Fælles kalendervisning med projekter, opgaver og private aftaler
- **Dark mode** - Mørk visning for øjenvenlighed
- **Mobilapp** - Native iOS/Android app til time-tracking on-the-go
- **PWA support** - Progressive Web App til offline time-tracking

### Compliance & Administration

- **GDPR-værktøjer** - Dataudtræk, anonymisering og sletning efter GDPR-krav
- **Backup & export** - Automatisk backup og fuld dataeksport
- **Audit log** - Detaljeret log over alle systemændringer til compliance
- **Custom felter** - Tilføj brugerdefinerede felter til kunder, projekter og opgaver
- **Tags/labels system** - Fleksibel kategorisering med tags

### Analyse & Indsigt

- **Tidsanalyse per kategori** - Gruppér timer efter brugerdefinerede kategorier
- **Rentabilitetsanalyse** - Sammenlign indtjening vs. timeforbrug per kunde/projekt
- **Trend-rapporter** - Grafer over udvikling i omsætning, timeforbrug og kundebase
- **Prognoser** - Forudsigelse af fremtidig omsætning baseret på historik

---

## 💰 Prismodel

**MÅNEDLIG ABONNEMENT:**
- 99 kr/md for første bruger
- +49 kr/md per ekstra bruger (fremtidig funktion)
- 30 dages pengene-tilbage garanti

**ÅRLIGT ABONNEMENT (2 måneder gratis):**
- 82,50 kr/md (990 kr/år) for første bruger
- +39 kr/md per ekstra bruger (fremtidig funktion)
- Ingen binding, ingen kreditkort til prøveperiode

**Alle planer inkluderer:**
- Ubegrænset antal kunder
- Timeregistrering med stopur
- Projektstyring
- Klippekortstyring
- Opgavestyring
- KundeHUB (kundeportal) - kommer i Fase 2

---

## 📋 Status på Features

### ✅ Implementeret (Fase 1 - KOMPLET!)

- Kundehåndtering: CRUD operationer, arkivering, detaljesider
- Projektstyring: CRUD operationer, status tracking, budgets
- Timeregistrering: Manuel oprettelse, stopur, oversigt, klippekort integration
- Klippekort: CRUD operationer, automatisk træk, **manuel træk**, historik, udløbshåndtering
- Opgavestyring: CRUD operationer, deadline-varsling, timer integration
- Tarifhåndtering: Global, kunde og projektsatser med hierarki
- Rate history tracking: Fuld historik over alle satsændringer
- Recurring templates: Automatisk generering af tilbagevendende tidsposter
- Basic rapportering: Ugentlige/månedlige rapporter, CSV eksport
- Dark mode: Fuld support overalt
- **Dashboard**: Customizable drag-and-drop dashboard med 14 widgets

### ✅ Implementeret (Fase 1.5 - AI Features!)

- **Email-to-Task**: Unik email-adresse per bruger, AI-parsing af emails
- **AI Task Management**: Smart kategorisering, tidsestimering, prioriteringsforslag
- **AI Autonomi-niveauer**: Foreslå, Auto (lavrisiko), Manuel
- **BYOK Support**: Brug egen API-nøgle eller self-hosted LLMs
- **Google Calendar**: OAuth integration med sync
- **Onboarding Flow**: Komplet onboarding med AI-opsætning

### ✅ Implementeret (Fase 2 - KOMPLET!)

- **Billy/Dinero integration**: Fuld sync med webhooks for betalingsstatus
- **e-conomic integration**: ERP sync
- **CVR-opslag integration**: Automatisk udfyldning af virksomhedsdata
- **Fakturering system**: Draft → Sent → Paid workflow, PDF, email
- **KundeHUB (kundeportal)**: White-label med custom branding
- **Avanceret rapportering**: Revenue, time, project health reports

### ✅ Implementeret (Fase 3 - Browser Extension!)

- **Chrome Extension**: Manifest V3, Chrome Web Store ready
- **Firefox Extension**: Manifest V2, AMO ready
- **Real-time timer sync**: Intent-baseret synkronisering
- **Project auto-detection**: URL pattern matching
- **Gmail integration**: Email-to-task direkte fra Gmail
- **New tab dashboard**: 14 widgets, konfigurerbart. Kan slås fra: Chrome viser så sin egen nye fane (Googles udgave), andre browsere en enkel side med søgefelt (#1322)
- **Offline support**: Offline queue med sync
- **Smart notifications**: Pattern detection, DND, digest mode

### ✅ Implementeret (Ekstra Features)

- **Team/Organization support**: Multi-user med roller
- **Platform-admin**: Forretningstal udelader testkonti som standard. Brug **Vis testkonti** for at tage dem med. Se [Admin og drift](ENTERPRISE-FEATURES.md#28-admin-og-drift) for manuel markering og mailfiltrering.
- **Notifications**: Email, Discord, Slack, Push, SMS
- **11 Cron jobs**: Automated tasks, reminders, sync
- **Webhooks**: Outgoing webhooks med retry logic
- **PWA support**: Installérbar, offline-capable
- **Startside efter login**: Vælg landingsside (Overblik/Tid/Opgaver/Kalender/Kunder/Projekter/Klippekort/Fakturaer) under Indstillinger; se ENTERPRISE-FEATURES.md S12

### 📅 Ikke Implementeret (Fremtidige Faser)

- MobilePay betalingsintegration
- Native mobilapp (iOS/Android)
- Gantt-chart visualisering
- Multi-currency support
- Outlook Calendar sync
- Voice assistant integration
- Blockchain time verification

---

**Senest opdateret:** 2026-01-30
