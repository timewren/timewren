# Fakturering: web og desktop (GPUI) side om side

Skrevet 20/11-2026 efter en bruger på macOS (desktop 0.2.29, 17/11) sendte en faktura som mail til sin kunde uden at have set en bekræftelse. Sammenligningen er læst i koden:

- **Web:** `mahope/timetrack`, `main` @ `c80fa8619`: `src/lib/trpc/routers/invoices.ts`, `src/lib/trpc/routers/ext/invoices.ts` (device-API'et, som desktop bruger), `src/app/(app)/dashboard/invoices/page.tsx` og `.../[id]/page.tsx`, `src/app/(app)/dashboard/time/page.tsx`.
- **Desktop:** `crates/tt-app/src/screens/fakturaer.rs`, `crates/tt-app/src/backend/{mod,repo,mock}.rs`, `crates/tt-data/src/{cloud,local}/mod.rs`.

## Hvad `send_invoice` gør

| Tilstand | Før | Nu |
|---|---|---|
| Cloud (logget ind) | `extension.invoices.send` → web's `invoices.sendEmail`: renderer PDF, **mailer den til kundens adresse i web**, giver kladden sit rigtige nummer og sætter status Sendt. Ét tryk på "Send via TimeTrack", ingen bekræftelse. | Samme kald, men kun fra "Send til kunden" i en bekræftelsesdialog, og datalaget afviser kaldet uden den bekræftede modtager. |
| Lokal (uden konto) | Udsteder (nummer + status Sendt). Sender aldrig mail. | Samme, med en bekræftelse, der siger "Der sendes ingen mail". |

Roden til sagen: i web er "Send Faktura" på en kladde **kun et statusskift** (`invoices.update` med status `sent`, ingen mail). Mailen er en separat handling ("Send Email" i en dialog med modtageren). Desktops "Send"-knap hed det samme, men gjorde begge dele på én gang.

## Flowet, trin for trin

Kolonnen "Forskel" er ⚠ ved en forskel, der stadig er der efter ændringen, og ✔ ved en, der er rettet eller aldrig fandtes.

| Trin | Web | Desktop før | Desktop nu | Forskel |
|---|---|---|---|---|
| Opret fra ufaktureret tid | `invoices.generateFromTimeEntries`: **kladde**, posterne markeres faktureret. Dialogen siger "Fakturaen oprettes som kladde, så du kan gennemse den før afsendelse" | `createDraft` (samme kald, idempotensnøgle): kun kladde | Uændret. Test: oprettelse sender intet og giver `Draft` uden `delivery` | ✔ |
| Statusser | `draft`, `sent`, `paid`, `overdue` (+ `deleted`, skjult). Tilstandsmaskine: kladde → sendt/slettet, sendt → betalt/forfalden, forfalden → betalt/sendt, betalt er endelig. Navne: Kladde, Sendt, Betalt, Forfalden | De samme fire. `deleted` filtreres fra i cloud-listen. Ukendt status fra en nyere server vises som Sendt | Uændret | ✔ |
| Kreditnotaer (`kind = credit_note`) | Oprettes fra en udstedt faktura ("Opret kreditnota?") og er den lovlige måde at annullere på | Vises som en almindelig faktura, kan ikke oprettes | Uændret | ⚠ |
| "Send Faktura" på kladde | Statusskift til Sendt, rigtigt nummer, **ingen mail** (også "Markér som sendt" i listen) | Fandtes ikke | "Markér som sendt (uden mail)" i cloud (`extension.invoices.update`, status `sent`). Dialogen siger "Der sendes ingen mail" | ✔ |
| Send som mail | Dialog "Send Faktura via Email": modtager (udfyldt med kundens mail, **kan rettes**), teksten "Fakturaen vil blive sendt som PDF vedhæftning til denne email adresse", knapperne Annuller og Send Email. REST `/api/invoices/{id}/send` med `recipientEmail` | Direkte, uden dialog | Dialog: "Fakturaen sendes på mail til {adresse}", kunde, fakturanummer, antal poster, timer, beløb inkl. moms. Knapperne "Send til kunden" og "Annuller". **Fokus står på Annuller; Enter og Esc sender ikke.** Uden bekræftet modtager sender datalaget intet | ✔ |
| Modtagerens adresse | Kan rettes i dialogen | Kundens mail i web | Kundens mail i web, vist og ikke redigerbar. Device-API'ets `send` kan kun mail til kundens adresse. Har kunden ingen mail, er "Send til kunden" slukket | ⚠ |
| Send igen / påmindelse | "Send påmindelse" på sendt og forfalden faktura, med bekræftelse ("Send faktura X til kunden på email?") | Ingen | "Send påmindelse" i cloud på sendt og forfalden faktura, med samme bekræftelse som afsendelsen (22/11, se `docs/v1/PARITET-WEB.md`) | ✔ |
| Fejl og usikkert svar | Toast med fejlen | Fejlteksten, evt. "Prøv igen" | Timeout og serverfejl siger "Fakturaen kan være sendt: tjek status i listen, før du prøver igen" og henter listen igen. Offline siger "Fakturaen er ikke sendt" (afsendelse lægges aldrig i offline-køen) | ✔ |
| Status i listen | Badge: Kladde, Sendt, Betalt, Forfalden | Badge | Badge + linje under kunden: "Ikke sendt" (kladde) eller "Sendt 20.11.2026 kl. 10:12 til kunde@…" | ✔ |
| Status i detaljen | Badge + e-mailaktivitet: Sendt, Leveret, Åbnet, Bounced, "til {modtager}", tidspunkt (fra webhooks) | Badge | Badge + linjen "Kladde. Ikke sendt endnu", "Sendt {dato} kl. {tid} til {modtager}" eller "Markeret som sendt … Ingen mail er sendt herfra" | ⚠ |
| Hvor tidspunkt og modtager kommer fra | Web's e-mailaktivitet | – | En lille fil (`invoice-sends.json` i datamappen) skrevet, når denne installation sender. Fakturaer sendt fra web eller en anden enhed viser "Tidspunkt og modtager kendes ikke her". Leveret, åbnet og bounced findes ikke (device-API'et har ikke e-mailaktivitet) | ⚠ |
| Markér betalt | `invoices.update` status `paid`, valgfri betalingsdato | `markPaid` uden dato | Spørger om betalingsdatoen, i dag som standard (22/11) | ✔ |
| Slet kladde | `invoices.delete` (blød sletning, frigiver posterne), bekræftelse "Slet faktura" | Kun lokalt. I cloud: "Kladder slettes i web" | Lokalt og i cloud, med bekræftelse (første tryk spørger, andet sletter). Posterne bliver ufaktureret igen. Cloud kalder `extension.invoices.delete`, **som device-API'et i web endnu ikke har** (se nedenfor) | ⚠ |
| Annullér en udstedt faktura | Kreditnota | Ingen | Ingen | ⚠ |
| Find poster, der er faktureret | Tidslisten: filter "Faktureret" (Alle, Faktureret, Ikke faktureret) og et badge "Faktureret" på posten. Fakturaen viser "Inkluderede Tidsposteringer" | Kun et "faktureret" i kalenderens poster | Kalenderen: filter Alle, Ikke faktureret, Faktureret (samme ord som web). Fakturaen viser antal poster og timer og "Vis i kalenderen" (den første dag, kun fakturerede poster). En faktureret post har "Åbn faktura" i editoren | ✔ |
| Fakturaer efter sync | Listen er sandheden | Samme (`extension.invoices.list` + `linesByInvoice`, SSE-hændelser genindlæser) | Uændret. Status og beløb følger web efter sync | ✔ |
| Eksport til Billy, Dinero, e-conomic | Fra fakturaens detalje | Ikke i GPUI-appen | Uændret | ⚠ |

## Tekster

Teksterne følger web's danske ord (Kladde, Sendt, Betalt, Forfalden, "Send faktura via email", "Annuller", "Markér som sendt", "Slet kladde", "Faktureret / Ikke faktureret") og findes i alle seks sprog under `crates/tt-app/locales/*/fakturaer.json` og `kalender.json`.

## Åbent (kræver ændringer i web)

1. **`extension.invoices.delete`** mangler i device-API'et (`src/lib/trpc/routers/ext/invoices.ts`). Det er en tynd videresendelse af `ctx.web.invoices.delete({ id })`, som allerede frigiver posterne. Desktop kalder den og viser "Din TimeTrack-konto understøtter ikke … endnu", indtil den findes. Lokalt virker sletning allerede.
2. **Modtager og e-mailaktivitet** i device-API'et (en valgfri `expectedRecipient` på `extension.invoices.send`, så web afviser, hvis kundens mail er ændret siden sidste sync, og `emailActivity.getInvoiceStatus` som `extension.invoices.emailStatus`, og en valgfri `recipientEmail` på `extension.invoices.send`) ville give desktop web's fulde statusvisning (Leveret, Åbnet, Bounced) og en rettelig modtager.
3. **Skærmbilleder** (`gpui-macos-shots`) skal tages på Mac'en: se PR-beskrivelsen.
