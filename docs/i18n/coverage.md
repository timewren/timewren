# Oversættelsesdækning (status 6/11-2026)

Sprog: da (kilde), en, de, es **og 14 nye beta-sprog**: sv, nb, fi, nl, fr, it, pt (pt-PT), pt-BR, pl, cs, ja, ko, zh-Hans, tr.
Infrastrukturen til dem er på plads (register, fald-tilbage til engelsk, kontrol, sprogvælger, skrifttyper; se
[README.md](README.md)); selve katalogerne oversættes i fire parallelle jobs og er endnu ikke tilføjet. Indtil da læser de nye sprog
engelsk. Alle nye sprog og de/es mærkes "beta" i sprogvælgeren. da og en er fuldstændige og håndhæves af
`npm run i18n:check`; de øvrige sprog må være delvise, men fejler på ukendte nøgler, forkerte pladsholdere og manglende
flertalsformer. de og es har i dag samme nøgler som da. **de og es er maskinelle udkast fra Claude, ikke korrekturlæst af en indfødt**: ingen nøgle står
i `review-approved.json`. `node scripts/i18n/check.mjs --report` viser antallet, der mangler korrektur.

| Pakke                                                                   | Katalog                                                           | Nøgler pr. sprog        | Oversat til                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| Web/server (app, onboarding, mails, notifikationer, fejl, PDF, eksport) | `src/i18n/messages/<sprog>/*.json` (97 navneområder)              | 13.032                  | da, en, de, es (14 nye: 0 nøgler, læser engelsk) |
| Browserudvidelse                                                        | `browser-extension/src/i18n/messages/` + `_locales`               | 564                     | da, en, de, es (14 nye: 0 nøgler, læser engelsk) |
| Desktop                                                                 | `crates/tt-app/locales/`, `src/locales/`, `src-tauri/src/i18n.rs` | 1.622 + 1.087 + ca. 170 | da, en, de, es (+ nb, sv)                        |
| Mobil                                                                   | `src/translations/`                                               | 1.682                   | da, en, de, es                                   |

Desktop og mobil ligger i deres egne repos; ændringerne er på grenene `oss/i18n-es` (desktop) og `oss/i18n-de-es`
(mobil) og skal merges af Mads, før de kommer med i en normal eksport (`EXPORT_REF=origin/<gren>`).

## Hvad der er dækket

Alle flader i den indloggede app, onboarding, login/registrering/OAuth, kundeportal og delte rapporter, indstillinger,
enterprise, mails og notifikationer (modtagerens sprog), tRPC- og API-fejl (kaldets sprog), faktura-PDF (afsenderens
sprog), eksporter og rapporter, instansadministration (brugere, indstillinger, aktivitet, overvågning), fejlsider samt
dato-, tal- og tidsformater.

## Bevidst ikke oversat

- **Markedsføringssider og blog** (`src/app/<mange sider>`, `src/components/marketing`, `src/lib/marketing`): TimeTrack
  Clouds egen hjemmeside, slået fra på selvhostede installationer (`src/lib/marketing-guard.ts`). De er danske.
- **Cloud-driftskonsol:** `src/app/admin/{finance,growth,analytics,broadcasts,support,prospects,stabilitet,desktop,
  webhooks,compliance,gdpr,security,feedback,help-feedback,roadmap,organizations,scenarios,onboarding-funnel,
  email-forwarding}` og `dashboard/admin/{finance,analytics,beta-signups,broadcasts,roadmap,help-feedback,
  email-forwarding}` samt `routers/admin` og `api/desktop/admin`. Beslutning til Mads: behold dansk, oversæt, eller
  udelad fra den offentlige eksport.
- **Juridisk tekst:** databehandleraftalen (side og PDF), engangsmailen `RebrandVarselEmail`, vilkår og privatliv.
- **Data og formater:** lønsystem-CSV (Danløn, SD Løn), CSV-formatet (semikolon, decimalkomma, "Ja/Nej"), importskabeloners
  placeholders (`{{firmanavn}}`), AI-prompter og danske tekstparsere (opgave- og tidsindtastning forstår danske ord),
  brugerdata (navne, beskrivelser), værdier gemt i databasen.
- **Fald-tilbage:** kode uden forespørgselskontekst (cron, tests) giver dansk; et sprog, hvor en nøgle, et navneområde eller et katalog mangler, læser engelsk (aldrig dansk); sprogstyrede API-svar til
  desktop og browserudvidelse er delvis ikke sprogstyret (`api/desktop/*`, dele af `routers/ext/*`).

## Åbne punkter

1. **Produktnavnet:** `src/i18n/brandize.ts` skifter "TimeTrack" til "TimeWren" i webkatalogerne. Udvidelsen (ca. 20 steder),
   desktop og mobil har stadig "TimeTrack" i teksterne. 163 steder i webkataloget bør på sigt bruge `{brand}`.
2. **Korrektur:** se `docs/i18n/glossary.md` for prioriteret rækkefølge (onboarding, fakturaer, mails til kunder,
   fejlbeskeder). Den uafhængige stikprøve (133 nøgler pr. sprog) fandt problemer i 14-15 %, heraf 3-4 % alvorlige;
   de 25 værste pr. sprog og de mekaniske regelbrud er rettet, resten af kataloget er ikke gennemgået.
3. **Fakturaens sprog** følger afsenderen; der findes ingen kunde- eller organisationsindstilling for fakturasprog.
4. **Fakturaens reg.nr.-linje** mangler IBAN/BIC-felter (kræver kodeændring).
5. **`onboarding.payment.trialExpires`:** teksten er omskrevet, så den læses korrekt uden dato; kodens fald-tilbage bør
   rettes i `PaymentStep.tsx`.
6. **Kørsel i browser:** siderne er kun bygget og login/registrering er renderet i alle fire sprog; dashboard, mails og PDF er
   dækket af tests og typecheck, men ikke set i en browser.
7. **Faktura-PDF på ja, ko og zh-Hans:** PDF'ens indlejrede font har ingen CJK-tegn, så PDF'en er på engelsk for de tre sprog, og
   CJK-brugerdata i PDF'en vises som firkanter. Kræver en indlejret CJK-font (flere MB), se README.md → Skrifttyper.
8. **Klientbundtet:** `syncT` (zod-beskeder og venlige fejl) er synkron og importerer `serverSync` statisk for alle sprog.
   Når de 14 nye kataloger er tilføjet (ca. 25 kB hver ukomprimeret), bør de lazy-indlæses i browseren i stedet.
9. **Browserudvidelsens sprogvælger** viser alle 18 sprog uanset brand; kun webappen skjuler de nye sprog på TimeTrack Cloud.
10. **Beta-sprogene skal have `review-approved.json`-korrektur** på samme måde som de/es, før "beta" kan fjernes.
