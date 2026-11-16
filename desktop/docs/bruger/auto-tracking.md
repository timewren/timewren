# Auto-tracking

## Hvordan det virker

TimeTrack Desktop registrerer automatisk hvilke programmer og vinduer du bruger, mens du arbejder.

### Teknisk

- Appen poller det aktive vindue **hvert 2. sekund**
- Den registrerer: programnavn, vinduestitel og tidspunkt
- Hvis du arbejder i en kode-editor (VS Code, WebStorm, m.fl.), registreres også det aktive Git-repository og branch
- Aktiviteter med samme program og vindue grupperes automatisk

### Hvad registreres?

- Programnavn (fx "Google Chrome", "Visual Studio Code")
- Vinduestitel (fx "TimeTrack Desktop -- README.md")
- Tidspunkt og varighed
- Git-repository og branch (kun for understøttede editors)

### Hvad registreres IKKE?

- Skærmindhold eller skærmbilleder
- Tastetryk eller musebevægelser
- Filindhold
- Browserhistorik eller URL'er (kun vinduestitlen)

## Privacy

**Dine aktivitetsdata forlader aldrig din computer.**

- Alle aktiviteter gemmes i en lokal SQLite-database på din maskine
- Aktiviteter synkroniseres **aldrig** til TimeTrack Cloud -- heller ikke hvis du har sync aktiveret
- Kun tidsregistreringer, klienter, projekter og klippekort synkroniseres (hvis du vælger det)
- Du kan til enhver tid slette alle aktivitetsdata fra Indstillinger

## Idle-detection

Appen registrerer når du forlader computeren:

- Hvis der ikke er tastatur- eller museaktivitet i et stykke tid, sættes tracking på pause
- Når du vender tilbage, genoptages tracking automatisk
- Idle-tid tæller ikke med i dine aktiviteter

## Pause og genoptag

### Pause tracking midlertidigt

Du kan pause auto-tracking fra:
- System tray-menuen (højreklik på TimeTrack-ikonet)
- Indstillinger → Tracking

Når tracking er sat på pause, registreres ingen aktiviteter.

### Ekskludér apps

Under **Indstillinger → Tracking** kan du angive programmer der ikke skal registreres. Tilføj programnavne (ét per linje) -- aktiviteter fra disse apps ignoreres.

## Fra aktivitet til tidsregistrering

Auto-tracking skaber **aktiviteter**, ikke tidsregistreringer. For at omdanne aktiviteter til fakturerbare timer:

1. Åbn **Tidslinjen** i sidebaren
2. Gennemgå dine aktiviteter for dagen
3. Klik **Bekræft** på en aktivitet for at oprette en tidsregistrering
4. Vælg projekt og klient i dialogen
5. Den bekræftede aktivitet bliver til en tidsregistrering

Du kan også bruge **AI-klassificering** til at automatisere dette trin -- se [AI-klassificering](ai-klassificering.md).

### Massebekræftelse

I tidslinjen kan du bekræfte flere aktiviteter på én gang:
1. AI klassificerer dine aktiviteter (hvis opsat)
2. Gennemgå forslagene
3. Klik **Bekræft alle** for at godkende dem samlet
