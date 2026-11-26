# Privatlivspolitik for TimeTrack-browserudvidelsen

**Senest opdateret: 26. oktober 2026**

Denne politik beskriver, hvilke data TimeTrack-browserudvidelsen ("udvidelsen") bruger, hvor de sendes hen, og hvorfor. Udvidelsen er en del af TimeTrack, og data på serveren behandles efter TimeTracks privatlivspolitik på https://timetrack.dk/privacy.

## Kort fortalt

- Udvidelsen sender kontodata til TimeTrack Cloud eller den selvhostede server, du selv vælger, og fejlrapporter til Sentry. En selvhostet servers administrator er ansvarlig for serverens behandling af dine data.
- Den læser ikke de sider, du besøger. Den kigger kun på den aktive fane, når du selv åbner udvidelsen, og det bliver på din computer.
- I Gmail sender den kun noget, når du trykker "Opret opgave".
- Vi sælger ikke data og bruger ingen analyse- eller reklametjenester.

## Data der sendes til TimeTrack

- **Login:** Et adgangstoken fra den valgte server. Det er bundet til serverens adresse og følger ikke redirects til andre adresser. Serverbytte fjerner det gamle token og lokale kontodata.
- **Timer og registreringer:** Timerens tilstand (kører, pause, tid, kunde, projekt og beskrivelse) og de tidsregistreringer, du opretter, retter eller sletter.
- **Inaktivitet:** Når en timer kører, og computeren har været inaktiv eller låst, sendes tidspunktet for, hvornår inaktiviteten begyndte. Det bruges til at spørge, om tiden skal tælle med. Udvidelsen ved kun, at du er inaktiv, ikke hvad du laver.
- **Opgaver fra Gmail:** Når du trykker "Opret opgave" i en åben mail, sendes mailens emne, afsenderens navn og mailadresse, datoen, Gmails tråd-id og op til de første 1000 tegn af mailens tekst. Det gemmes som en opgave på din TimeTrack-konto. Uden et tryk sendes intet fra Gmail.

### AI-forslag til opgaver fra Gmail

Udvidelsen beder serveren om at foreslå et projekt til opgaven. Serveren prøver først at finde projektet ud fra navne og ord i mailen. Hvis det ikke giver et sikkert match, og AI er slået til på TimeTracks server, sendes opgavens titel og beskrivelse (altså mailens emne, afsenderens navn og mailadresse, dato og de op til 1000 tegn) til OpenAI sammen med navne og id'er på dine aktive projekter og kunder og kundernes maildomæne. Svaret bruges kun til at foreslå et projekt på opgaven.

## Fejlrapporter

Opstår der en fejl i udvidelsen, sendes en fejlrapport til Sentry: fejlbeskeden, hvor i koden den opstod, browser- og udvidelsesversion samt adressen på kaldet til TimeTrack. Adgangstokenet fjernes fra adresserne, før rapporten sendes. Der sendes ingen målinger af ydelse eller brug.

## Data der kun ligger på din computer

Følgende gemmes i browserens lager for udvidelser og sendes ikke nogen steder hen:

- Adgangstokenet, den valgte organisation og dit navn fra TimeTrack.
- Dine indstillinger for udvidelsen.
- Registreringer, der venter på at blive sendt, mens du er offline. De sendes til TimeTrack, når forbindelsen er tilbage.
- Websitekoblinger: når du vælger et projekt på et websted, huskes koblingen mellem domænet og projektet, så udvidelsen kan foreslå det næste gang. Du kan slette koblingerne i indstillingerne.
- En kopi af dine kunder og projekter, så udvidelsen åbner hurtigt.

## Tilladelser

- **storage:** gemmer token, indstillinger, offline-kø og websitekoblinger lokalt.
- **alarms:** henter timerens tilstand med jævne mellemrum, sender offline-køen og tjekker den daglige påmindelse.
- **notifications:** viser beskeder om timeren, påmindelser og spørgsmålet om tid, mens du var væk.
- **activeTab:** når du åbner udvidelsen, læses adresse, titel og ikon for den aktive fane for at foreslå et projekt. Det sker på din computer og sendes ikke.
- **identity:** åbner login-vinduet på den valgte server og modtager adgangstokenet bagefter.
- **idle:** registrerer, om computeren er aktiv, inaktiv eller låst.
- **search:** når TimeTrack er slået fra på nye faner i en browser uden adgang til sin egen nye fane (fx Edge og Firefox), sendes det, du skriver i søgefeltet, til browserens standardsøgemaskine. Udvidelsen gemmer ikke søgningen.
- **timetrack.dk og underdomæner:** al kommunikation med TimeTrack.
- **Valgfri adgang til en selvhostet HTTPS-adresse:** bruges kun efter dit klik på “Forbind til server” og browserens tilladelse. Adgangen bruges til servervalidering, login, tidsregistrering og synkronisering med den valgte server.
- **mail.google.com:** viser knappen "Opret opgave" i Gmail.

## Dine valg

- Log ud for at fjerne token og organisation fra udvidelsen. Afinstallér udvidelsen for at fjerne alle lokale data.
- Slå site-forslag fra i indstillingerne, og slet websitekoblingerne der.
- Brug ikke knappen i Gmail, hvis ingen mails skal sendes til TimeTrack.
- Tilbagekald udvidelsens adgang i TimeTrack under indstillinger.
- Data på din TimeTrack-konto kan ses, rettes og slettes i webappen.

## Sikkerhed

Al kommunikation sker over HTTPS. Adgangstokenet kan tilbagekaldes når som helst i TimeTrack.

## Ændringer

Ændres politikken, opdateres datoen øverst.

## Kontakt

Mail: privacy@timetrack.dk
Web: https://timetrack.dk/contact
