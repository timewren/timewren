# TimeWren: ordliste og oversættelsesregler (18 sprog)

Dansk er kildesprog. de og es har egne regler nedenfor; de 14 nye sprog (sv, nb, fi, nl, fr, it, pt, pt-BR, pl, cs, ja, ko, zh-Hans, tr) står i sidste afsnit. Ordlisten sikrer, at samme begreb hedder det samme overalt. Ret
ordlisten først, hvis en oversættelse kræver et nyt valg, og brug den derefter i alle
filer. `npm run i18n:check` kontrollerer nøgler og pladsholdere, ikke ordvalg.

## Tone og form

| Sprog | Tiltale | Tone                                                                     |
| ----- | ------- | ------------------------------------------------------------------------ |
| da    | du      | Direkte og jordnær. Ingen tankestreger, ingen salgssprog.                |
| en    | you     | Plain British English ("organisation" i kode og tekst: se nedenfor).     |
| de    | du      | Klar og høflig uden Behördendeutsch. Inklusive former: "Mitarbeitende".  |
| es    | tú      | Neutralt spansk (ikke regional slang). Inklusivt, hvor det er naturligt. |
- Dansk "I/jeres" til en organisation som gruppe i produktets egen UI: de "ihr/euer" er tilladt, es bruger entalsformen "tú/tu" (neutralt spansk, ikke "vosotros"). Reglen "aldrig Sie" gælder kun produkt-UI'et; for kundevendte tekster, se registerreglen nedenfor.
- de bruger kolonformen til roller (Administrator:in, Inhaber:in, Freiberufler:in) og participiet i flertal ("Mitarbeitende"). Brug ikke andre kønsformer (Binnen-I, stjerne).
- Skriv, som en indfødt freelancer ville skrive i et værktøj. Ingen ord-for-ord-oversættelse.
- Knapper er korte verber ("Speichern", "Guardar"). Fejl siger hvad der skete og hvad man kan gøre.
- Kun `…` (ét tegn) til "arbejder", ikke tre punktummer, i de og es; i da og en følger vi eksisterende filer.
- Pladsholdere (`{count}`, `{name}`) og ICU-former (`{count, plural, one {…} other {…}}`) bevares nøjagtigt.
  Tysk og spansk skal have gyldige `one`/`other`-former; spansk har også `many` for store tal, men `one`/`other` er nok.
- Tal, datoer, valuta og tidszoner formateres med `Intl`/next-intl efter sprog, aldrig hardcodet.
- Produktnavne oversættes ikke: TimeWren, Billy, Dinero, e-conomic, Stripe, Pomodoro.
- Danske lovbegreber (CVR, SKAT, moms, ferieloven) står uændret med en kort forklaring, hvor læseren ikke kender dem.

## Registerregel: produkt-UI mod kundevendte tekster

- **Produktets egen UI til brugeren (freelanceren)**: de "du", es "tú". Aldrig "vosotros".
- **Tekster til freelancerens KUNDER** (faktura-PDF `pdf.*`, `emailsBilling.*`, `portal.*` og andre kundemails): de bruger "Sie" eller upersonlig form ("Zahlbar bis {date}."), es bruger "usted" eller upersonlig form ("Se ruega pagar antes del {date}."). Alle former som "du/ihr/tú/vosotros" er forkert B2B-register i Tyskland og Spanien.
- Mails til brugeren selv (drip, auth, rapporter) følger produkt-UI'et (du/tú).

## Faste begreber

(Rækker under "Yderligere valg" nedenfor har forrang, hvis de afviger fra tabellen.)

| Dansk                         | English                      | Deutsch                                    | Español                        | Note                                                                                                                                   |
| ----------------------------- | ---------------------------- | ------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| klippekort                    | prepaid package              | Stundenpaket                               | bono de horas                  | Kernebegreb: forudbetalt blok timer                                                                                                    |
| tidsregistrering              | time tracking                | Zeiterfassung                              | registro de horas              |                                                                                                                                        |
| tidsregistrering (post)       | time entry                   | Zeiteintrag                                | registro de tiempo             |                                                                                                                                        |
| timeseddel                    | timesheet                    | Stundenzettel                              | hoja de horas                  |                                                                                                                                        |
| kunde                         | client                       | Kunde                                      | cliente                        | Aldrig "customer" i produktet                                                                                                          |
| projekt                       | project                      | Projekt                                    | proyecto                       |                                                                                                                                        |
| opgave                        | task                         | Aufgabe                                    | tarea                          |                                                                                                                                        |
| faktura                       | invoice                      | Rechnung                                   | factura                        |                                                                                                                                        |
| kreditnota                    | credit note                  | Rechnungskorrektur                         | factura rectificativa          | Aldrig "Gutschrift" (UStG: selvfakturering) eller "nota de crédito"/"abono". Verbum: korrigieren/stornieren, rectificar                |
| fakturér                      | invoice (verb)               | abrechnen / in Rechnung stellen            | facturar                       |                                                                                                                                        |
| timepris / sats               | hourly rate                  | Stundensatz                                | tarifa por hora                |                                                                                                                                        |
| afrunding                     | rounding                     | Rundung                                    | redondeo                       |                                                                                                                                        |
| fakturerbar                   | billable                     | abrechenbar                                | facturable                     |                                                                                                                                        |
| ikke-fakturerbar / intern tid | non-billable / internal time | nicht abrechenbar / interne Zeit           | no facturable / tiempo interno |                                                                                                                                        |
| dækningsgrad                  | utilisation rate             | Auslastung                                 | tasa de utilización            |                                                                                                                                        |
| saldo                         | balance                      | Saldo / Restguthaben (klippekort)          | saldo / horas restantes        |                                                                                                                                        |
| kørebog / logbog              | logbook                      | Fahrtenbuch                                | libro de desplazamientos       | Kørsel til kunder                                                                                                                      |
| kalender                      | calendar                     | Kalender                                   | calendario                     |                                                                                                                                        |
| rapport                       | report                       | Bericht                                    | informe                        |                                                                                                                                        |
| skabelon                      | template                     | Vorlage                                    | plantilla                      |                                                                                                                                        |
| integration                   | integration                  | Integration                                | integración                    |                                                                                                                                        |
| organisation                  | organisation                 | Organisation                               | organización                   | Britisk stavemåde i en                                                                                                                 |
| medarbejder                   | employee                     | Mitarbeiter:in → "Mitarbeitende" i flertal | empleado/a → "empleados"       | Brug flertalsform, hvor muligt. Aldrig generisk "Mitarbeiter" eller "die Mitarbeiterin bzw. der Mitarbeiter"; i fejl kort "die Person" |
| afdeling                      | department                   | Abteilung                                  | departamento                   |                                                                                                                                        |
| ferie / fravær                | leave / absence              | Urlaub / Abwesenheit                       | vacaciones / ausencias         |                                                                                                                                        |
| afspadsering                  | time off in lieu             | Freizeitausgleich                          | compensación con descanso      |                                                                                                                                        |
| flex                          | flex time                    | Gleitzeit                                  | horario flexible               |                                                                                                                                        |
| periodeafslutning             | period closing               | Periodenabschluss                          | cierre de periodo              |                                                                                                                                        |
| godkendelse                   | approval                     | Freigabe                                   | aprobación                     | de: freigeben (timesedler, perioder), genehmigen (fravær/ferie). es: aprobar                                                           |
| kundeportal                   | client portal                | Kundenportal                               | portal de clientes             |                                                                                                                                        |
| arkivér                       | archive                      | archivieren                                | archivar                       | Vi sletter aldrig brugerdata, vi arkiverer                                                                                             |
| slet                          | delete                       | löschen                                    | eliminar                       |                                                                                                                                        |
| indstillinger                 | settings                     | Einstellungen                              | ajustes                        |                                                                                                                                        |
| overblik                      | overview                     | Übersicht                                  | resumen                        |                                                                                                                                        |
| tema                          | theme                        | Design                                     | tema                           | Lyst/mørkt                                                                                                                             |
| abonnement                    | subscription                 | Abonnement                                 | suscripción                    |                                                                                                                                        |
| selvhostet                    | self-hosted                  | selbst gehostet                            | autoalojado                    |                                                                                                                                        |
| browserudvidelse              | browser extension            | Browser-Erweiterung                        | extensión del navegador        |                                                                                                                                        |
| mobil-app                     | mobile app                   | mobile App                                 | aplicación móvil               |                                                                                                                                        |
| desktop-app                   | desktop app                  | Desktop-App                                | aplicación de escritorio       |                                                                                                                                        |
| timer (stopur)                | timer                        | Timer                                      | cronómetro                     | Start/stop-uret (temporizador er en nedtæller)                                                                                         |
| pause                         | break                        | Pause                                      | pausa                          | Pomodoro: "Pomodoro" bevares                                                                                                           |
| mail                          | email                        | E-Mail                                     | correo electrónico             |                                                                                                                                        |
| adgangskode                   | password                     | Passwort                                   | contraseña                     |                                                                                                                                        |
| log ind / log ud              | sign in / sign out           | anmelden / abmelden                        | iniciar sesión / cerrar sesión |                                                                                                                                        |
| tomt (tilstand)               | empty state                  | noch keine Einträge                        | todavía no hay nada            | Forklar hvad man gør næste gang                                                                                                        |

## Yderligere valg (korrekturrunde 2026-11-05)

| Begreb                                            | Deutsch                                                                                  | Español                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| reg.nr. / kontonr.                                | "Reg.-Nr. (DK)", Kontonr., plus IBAN/BIC. Aldrig BLZ                                     | "Reg.nr. (Dinamarca)", n.º de cuenta, plus IBAN/BIC. Aldrig "código de oficina" |
| faste ferieuger / lukkeperiode                    | Betriebsferien (overalt)                                                                 | cierre vacacional (overalt)                                                     |
| periodeopgørelse / kvittér                        | Periodenübersicht / bestätigen (ikke Abrechnung/quittieren)                              | resumen del periodo / confirmar (ikke liquidación)                              |
| lønart                                            | Lohnart                                                                                  | concepto salarial                                                               |
| lane (kanban)                                     | Spalte                                                                                   | columna (ikke carril)                                                           |
| retainer                                          | Retainer / Pauschalvertrag                                                               | iguala (mensual), aldrig "retainer"                                             |
| overtræk (klippekort)                             | Überziehung                                                                              | exceso de horas                                                                 |
| stopur                                            | Timer                                                                                    | cronómetro                                                                      |
| plannavne (Gratis, Selvstændig, Team, Virksomhed) | stå i anførselstegn eller bøjes som adjektiv ("im kostenlosen Tarif", "im Tarif „Free“") | tilsvarende ("en el plan gratuito")                                             |

Typografi (de og es):
- Mellemrum før procenttegn: "10 %". Ét `…`-tegn uden foranstillet mellemrum efter et helt ord ("Laden…"). Aldrig "...".
- Ingen tankestreger (—, –) i nogen sprog; brug komma, punktum eller kolon.
- Kønsformer: de "Mitarbeiter:in" i singularis, "Mitarbeitende" i flertal; i korte fejl "die Person".
- Danske lovhenvisninger (fx § 2, 48-timersreglen) skrives med kort forklaring: "(dänisches Arbeitszeitgesetz)" / "(ley danesa de jornada laboral)".
- Produktnavnet i oversættelser: brug `{brand}`, hvor pladsholderen findes; ellers "TimeWren".

## Menneskelig korrektur

Alle de- og es-tekster er maskinelle udkast fra Claude, indtil en indfødt har læst dem.

- `src/i18n/messages/review-approved.json` indeholder nøgler pr. sprog, som et menneske har godkendt.
  Alt andet i de/es tæller som "kræver korrektur". `node scripts/i18n/check.mjs --report` viser antallet.
- Prioritér korrektur af: onboarding, fejlbeskeder, fakturaer og mails (der ses af kunder),
  derefter indstillinger, derefter resten.
- en er skrevet af Claude ud fra dansk. Den bør også læses, men er ikke markeret.
- Godkend ved at lægge nøglerne i `review-approved.json`; ret tekst og ordliste i samme PR, hvis korrekturen ændrer et valg.
- Ingen automatisk flytning til "godkendt": en nøgle, hvis tekst ændres, skal godkendes igen.

## Nye sprog (beta, besluttet 6/11-2026)

Sprogene sv, nb, fi, nl, fr, it, pt (europæisk portugisisk, pt-PT), pt-BR, pl, cs, ja, ko, zh-Hans og tr er beta. Alle nye
sprog og de/es vises med "beta" i sprogvælgeren. Kataloget må være delvist: en nøgle, der ikke er oversat, læses på
**engelsk** (aldrig dansk). Oversæt hellere færre nøgler godt end alle dårligt.

### Regler for alle nye sprog

- Kilden er den danske tekst; den engelske er hjælp til betydningen, ikke kilde. Ved tvivl vinder dansk.
- Pladsholdere og ICU-former bevares nøjagtigt (`{count}`, `{name}`, `{count, plural, one {…} other {…}}`). Oversæt kun
  teksten i grenene. Flertal skal have alle sprogets kategorier (se tabellen); `=0`/`=1` må bruges ud over dem.
- Tal, datoer, valuta og tidszoner formateres med `Intl`/next-intl efter sprog, aldrig skrevet ind i teksten.
- Produktnavnet står som "TimeWren" (eller `{brand}`, hvor pladsholderen findes). "TimeTrack Cloud" er navnet på den hostede
  tjeneste og oversættes ikke. Billy, Dinero, e-conomic, Stripe og Pomodoro oversættes ikke.
- **klippekort** er det begreb, der kræver mest omtanke: en blok forudbetalte timer, som tidsregistreringer trækker fra.
  Brug ét ord overalt (tabellerne nedenfor), og forklar det ikke igen i hver tekst.
- Ingen tankestreger (—, –); brug komma, punktum eller kolon.
- Danske lovbegreber (CVR, SKAT, moms, ferieloven) står uændret med en kort forklaring, hvor læseren ikke kender dem.
- Kundevendte tekster (faktura-PDF `pdf.*`, `emailsBilling.*`, `portal.*`) følger sprogets høflige B2B-register; produktets
  egen UI til freelanceren følger tiltaleformen i tabellen.
- Tegn: tjek at dit sprog kan sættes i fakturaens PDF-font (se nedenfor). ja, ko og zh-Hans kan ikke, så faktura-PDF'en
  falder tilbage til engelsk; oversæt alligevel `pdf.json`, så den er klar den dag fonten findes.

Tabellerne er **forslag** fra infrastrukturjobbet, så oversætterne har et fælles udgangspunkt. Er et forslag forkert eller
uidiomatisk, så ret rækken her i samme ændring og brug det rettede ord overalt. Mulige flertalskategorier er målt med
`Intl.PluralRules`; `scripts/i18n/check.mjs` fejler, hvis en `plural` med navngivne former mangler en af dem.

| Sprog   | Tiltale (UI, forslag)                  | Flertalskategorier (Intl)    | Filer                                                    |
| ------- | -------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| sv      | du                                     | one, other                   | `messages/sv/`, extension `messages/sv/`, `_locales/sv/` |
| nb      | du                                     | one, other                   | `nb`, `_locales/nb/`                                     |
| fi      | sinä, oftest uden pronomen (imperativ) | one, other                   | `fi`, `_locales/fi/`                                     |
| nl      | je                                     | one, other                   | `nl`, `_locales/nl/`                                     |
| fr      | vous                                   | one, many (store tal), other | `fr`, `_locales/fr/`                                     |
| it      | tu i UI, Lei i kundevendte tekster     | one, many (store tal), other | `it`, `_locales/it/`                                     |
| pt      | tu/você neutralt; europæisk ordforråd  | one, many (store tal), other | `pt`, `_locales/pt_PT/`                                  |
| pt-BR   | você; brasiliansk ordforråd            | one, many (store tal), other | `pt-BR`, `_locales/pt_BR/`                               |
| pl      | du-form uden pronomen (imperativ) / Ty | one, few, many, other        | `pl`, `_locales/pl/`                                     |
| cs      | vy (høfligt) i UI                      | one, few, many, other        | `cs`, `_locales/cs/`                                     |
| ja      | です・ます                             | other                        | `ja`, `_locales/ja/`                                     |
| ko      | 해요체 (UI), 합니다체 (kundevendt)     | other                        | `ko`, `_locales/ko/`                                     |
| zh-Hans | 你 i UI, 您 i kundevendte tekster      | other                        | `zh-Hans`, `_locales/zh_CN/`                             |
| tr      | siz                                    | one, other                   | `tr`, `_locales/tr/`                                     |

`many` i fr, it, pt og pt-BR gælder kun store tal (millioner) og kræves ikke af kontrollen. I pl og cs gælder `many`
almindelige tal (pl) hhv. brøker (cs) og kræves.

### Faste begreber pr. sprog

Dansk begreb først; "prepaid hours" er den engelske betydning af klippekort. Samme begreber gælder i browserudvidelsen.

#### Svenska (sv)

| Dansk                      | Svenska                  |
| -------------------------- | ------------------------ |
| klippekort (prepaid hours) | klippkort                |
| TimeWren                   | TimeWren                 |
| TimeTrack Cloud            | TimeTrack Cloud          |
| selvhost / selvhostet      | egen drift / självhostad |
| tidsregistrering           | tidrapportering          |
| kunde                      | kund                     |
| faktura                    | faktura                  |
| kreditnota                 | kreditfaktura            |

#### Norsk bokmål (nb)

| Dansk                      | Norsk bokmål           |
| -------------------------- | ---------------------- |
| klippekort (prepaid hours) | klippekort             |
| TimeWren                   | TimeWren               |
| TimeTrack Cloud            | TimeTrack Cloud        |
| selvhost / selvhostet      | egendrift / selvhostet |
| tidsregistrering           | timeføring             |
| kunde                      | kunde                  |
| faktura                    | faktura                |
| kreditnota                 | kreditnota             |

#### Suomi (fi)

| Dansk                      | Suomi                             |
| -------------------------- | --------------------------------- |
| klippekort (prepaid hours) | tuntipaketti (ennakkoon maksettu) |
| TimeWren                   | TimeWren                          |
| TimeTrack Cloud            | TimeTrack Cloud                   |
| selvhost / selvhostet      | oma palvelin / itse ylläpidetty   |
| tidsregistrering           | ajanseuranta                      |
| kunde                      | asiakas                           |
| faktura                    | lasku                             |
| kreditnota                 | hyvityslasku                      |

#### Nederlands (nl)

| Dansk                      | Nederlands                  |
| -------------------------- | --------------------------- |
| klippekort (prepaid hours) | urenpakket (vooruitbetaald) |
| TimeWren                   | TimeWren                    |
| TimeTrack Cloud            | TimeTrack Cloud             |
| selvhost / selvhostet      | zelf hosten / zelf gehost   |
| tidsregistrering           | tijdregistratie             |
| kunde                      | klant                       |
| faktura                    | factuur                     |
| kreditnota                 | creditnota                  |

#### Français (fr)

| Dansk                      | Français                        |
| -------------------------- | ------------------------------- |
| klippekort (prepaid hours) | forfait d'heures (prépayé)      |
| TimeWren                   | TimeWren                        |
| TimeTrack Cloud            | TimeTrack Cloud                 |
| selvhost / selvhostet      | auto-hébergement / auto-hébergé |
| tidsregistrering           | suivi du temps                  |
| kunde                      | client                          |
| faktura                    | facture                         |
| kreditnota                 | avoir                           |

#### Italiano (it)

| Dansk                      | Italiano                     |
| -------------------------- | ---------------------------- |
| klippekort (prepaid hours) | pacchetto di ore (prepagato) |
| TimeWren                   | TimeWren                     |
| TimeTrack Cloud            | TimeTrack Cloud              |
| selvhost / selvhostet      | self-hosting / self-hosted   |
| tidsregistrering           | rilevazione del tempo        |
| kunde                      | cliente                      |
| faktura                    | fattura                      |
| kreditnota                 | nota di credito              |

#### Português, Portugal (pt)

| Dansk                      | Português (pt-PT)                |
| -------------------------- | -------------------------------- |
| klippekort (prepaid hours) | pacote de horas (pré-pago)       |
| TimeWren                   | TimeWren                         |
| TimeTrack Cloud            | TimeTrack Cloud                  |
| selvhost / selvhostet      | alojamento próprio / autoalojado |
| tidsregistrering           | registo de tempo                 |
| kunde                      | cliente                          |
| faktura                    | fatura                           |
| kreditnota                 | nota de crédito                  |

#### Português, Brasil (pt-BR)

| Dansk                      | Português (pt-BR)                   |
| -------------------------- | ----------------------------------- |
| klippekort (prepaid hours) | pacote de horas (pré-pago)          |
| TimeWren                   | TimeWren                            |
| TimeTrack Cloud            | TimeTrack Cloud                     |
| selvhost / selvhostet      | hospedagem própria / auto-hospedado |
| tidsregistrering           | registro de tempo                   |
| kunde                      | cliente                             |
| faktura                    | fatura                              |
| kreditnota                 | nota de crédito                     |

#### Polski (pl)

| Dansk                      | Polski                                  |
| -------------------------- | --------------------------------------- |
| klippekort (prepaid hours) | pakiet godzin (przedpłacony)            |
| TimeWren                   | TimeWren                                |
| TimeTrack Cloud            | TimeTrack Cloud                         |
| selvhost / selvhostet      | własny hosting / samodzielnie hostowany |
| tidsregistrering           | rejestracja czasu                       |
| kunde                      | klient                                  |
| faktura                    | faktura                                 |
| kreditnota                 | faktura korygująca                      |

#### Čeština (cs)

| Dansk                      | Čeština                       |
| -------------------------- | ----------------------------- |
| klippekort (prepaid hours) | balíček hodin (předplacený)   |
| TimeWren                   | TimeWren                      |
| TimeTrack Cloud            | TimeTrack Cloud               |
| selvhost / selvhostet      | vlastní hosting / self-hosted |
| tidsregistrering           | evidence času                 |
| kunde                      | klient                        |
| faktura                    | faktura                       |
| kreditnota                 | dobropis                      |

#### 日本語 (ja)

| Dansk                      | 日本語           |
| -------------------------- | ---------------- |
| klippekort (prepaid hours) | 前払い時間パック |
| TimeWren                   | TimeWren         |
| TimeTrack Cloud            | TimeTrack Cloud  |
| selvhost / selvhostet      | セルフホスト     |
| tidsregistrering           | 時間記録         |
| kunde                      | クライアント     |
| faktura                    | 請求書           |
| kreditnota                 | クレジットノート |

#### 한국어 (ko)

| Dansk                      | 한국어           |
| -------------------------- | ---------------- |
| klippekort (prepaid hours) | 선불 시간 패키지 |
| TimeWren                   | TimeWren         |
| TimeTrack Cloud            | TimeTrack Cloud  |
| selvhost / selvhostet      | 셀프 호스팅      |
| tidsregistrering           | 시간 기록        |
| kunde                      | 고객             |
| faktura                    | 청구서           |
| kreditnota                 | 크레딧 노트      |

#### 简体中文 (zh-Hans)

| Dansk                      | 简体中文        |
| -------------------------- | --------------- |
| klippekort (prepaid hours) | 预付工时包      |
| TimeWren                   | TimeWren        |
| TimeTrack Cloud            | TimeTrack Cloud |
| selvhost / selvhostet      | 自托管          |
| tidsregistrering           | 工时记录        |
| kunde                      | 客户            |
| faktura                    | 发票            |
| kreditnota                 | 贷项通知单      |

#### Türkçe (tr)

| Dansk                      | Türkçe                       |
| -------------------------- | ---------------------------- |
| klippekort (prepaid hours) | ön ödemeli saat paketi       |
| TimeWren                   | TimeWren                     |
| TimeTrack Cloud            | TimeTrack Cloud              |
| selvhost / selvhostet      | kendi sunucunuzda barındırma |
| tidsregistrering           | zaman takibi                 |
| kunde                      | müşteri                      |
| faktura                    | fatura                       |
| kreditnota                 | iade faturası                |
