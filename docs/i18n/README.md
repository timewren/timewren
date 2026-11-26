# Oversættelse af TimeWren (18 sprog)

Sprogene er `da` (kilde), `en`, `de`, `es` og de 14 nye beta-sprog `sv`, `nb`, `fi`, `nl`, `fr`, `it`, `pt` (pt-PT), `pt-BR`,
`pl`, `cs`, `ja`, `ko`, `zh-Hans` og `tr`. Ordvalg og tone: [glossary.md](glossary.md). Dækning og åbne punkter:
[coverage.md](coverage.md).

## Sprogregistret og beta-sprog

- **Ét register:** `LOCALE_META` i `src/i18n/config.ts` (kode, endonym, Intl-kode, Chrome-kode, beta, PDF-font, TimeTrack Cloud).
  Koder er BCP 47 (`pt-BR`, `zh-Hans`; `pt` er europæisk portugisisk). To spejle, som ikke kan læse TypeScript, skal være
  identiske: `scripts/i18n/catalogs.json` (scripts) og `LOCALE_META` i `browser-extension/src/i18n/core.ts` (udvidelsen er en
  separat pakke). `src/i18n/__tests__/locale-registry.test.ts` fejler, hvis de tre afviger.
- **Chrome `_locales`** bruger understreg og egne koder: `pt` → `pt_PT`, `pt-BR` → `pt_BR`, `zh-Hans` → `zh_CN`, ellers samme kode.
  Mappingen står i `LOCALE_META[kode].chrome`.
- **Fuldstændige sprog:** `da` og `en`. Resten er beta og vises med "(beta)" i sprogvælgerne (web: login og Indstillinger;
  udvidelsen: Indstillinger → Sprog), med endonymet (Svenska, Norsk bokmål, 日本語, …).
- **Fald-tilbage:** mangler et katalog, et navneområde eller en nøgle, læses **engelsk**, aldrig dansk og aldrig en rå nøgle.
  Det gælder alle indgange: `loadMessages` (app), `getT`, `staticMessages` (mails, PDF, `sharedT`, `syncT`) og udvidelsens
  `translate`. Dansk har ingen reserve. Logikken ligger i `src/i18n/fallback.ts`, testet i `src/i18n/__tests__/fallback.test.ts`.
  `_locales` er undtaget: Chrome falder selv tilbage til `default_locale` (dansk), så hver `_locales`-mappe skal være fuldstændig.
- **Brand:** TimeTrack Cloud (`NEXT_PUBLIC_BRAND=timetrack`, timetrack.dk) viser fortsat kun `da`, `en`, `de` og `es`
  (`availableLocales()`); TimeWren (selvhost) viser alle 18. En cookie, profil eller `Accept-Language` med et andet sprog giver
  dansk på Cloud. Registret (`isLocale`) er brandløst, så gemte værdier og tests ikke afhænger af brandet.

### Tilføj eller udvid et sprog

1. Opret `src/i18n/messages/<kode>/<navneområde>.json`, `browser-extension/src/i18n/messages/<kode>/<navneområde>.json` og
   `browser-extension/_locales/<chrome-kode>/messages.json` (alle `_locales`-nøgler). Navneområder og nøgler, du ikke oversætter, kan udelades.
2. `npm run i18n:build` (genererer `src/i18n/messages/load.ts`, `static.ts` og `src/i18n/catalogs/<navneområde>.ts`; de importerer kun filer, der findes).
   Rør dem ikke i hånden. Flere oversættelsesjobs kan ramme samme genererede fil, så kør `i18n:build` igen efter en merge.
3. `node scripts/i18n/check.mjs --lang <kode>` (flere: `--lang sv,nb`) mens du arbejder, `npm run i18n:check` til sidst.
4. Et helt nyt sprog tilføjes i `LOCALE_META` (`config.ts`), `browser-extension/src/i18n/core.ts` og `catalogs.json` (`locales`, `chrome`, `intl`).

`check.mjs` kræver for da og en fuldstændighed. For de øvrige sprog fejler den på: ugyldig JSON, tekst der ikke er en streng,
tom tekst, nøgler eller filer der ikke findes i da, ubalancerede klammer, pladsholdere der afviger fra da, og
`plural`/`selectordinal` med navngivne former der mangler en af sprogets kategorier (`Intl.PluralRules`: pl og cs `one/few/many/other`,
ja/ko/zh kun `other`; `many` kræves ikke i fr, it, pt, hvor den kun gælder millioner). `=0`/`=1` dækker `zero`/`one`.
`--report` viser dækning pr. sprog og katalog.

### Skrifttyper

- **Web:** Schibsted Grotesk indlæses med `latin` og `latin-ext` (pl, cs, tr, fi). Font-stakken (`--font-sans`, `--bb-font`)
  har systemets CJK-skrifttyper som fald-tilbage (Hiragino, Yu Gothic, PingFang, Microsoft YaHei, Malgun Gothic, Noto Sans CJK),
  så ja, ko og zh-Hans vises uden en eneste fontfil. `<html lang>` er sprogkoden, så browseren vælger de rigtige tegnformer.
- **Faktura-PDF** (react-pdf og takumi-pdf) indlejrer Schibsted Grotesk (latin + latin-ext, `src/lib/pdf/fonts/`). Den dækker alle
  de latinske sprog, inklusive pl, cs, tr og fi (`src/lib/pdf/pdf-font-coverage.test.ts`), men **ingen CJK-tegn**. For ja, ko og zh-Hans
  falder PDF'ens tekster og Intl-format derfor tilbage til engelsk (`pdfText`, `pdf: false` i registret). Brugerdata i CJK
  (kundenavne, linjer) vises i PDF'en som tomme firkanter. Løsningen er en indlejret CJK-font (Noto Sans CJK/Source Han Sans, SIL OFL):
  en CJK-font er flere MB pr. skrifttype og kan ikke subsættes statisk, så den er ikke tilføjet. Åbent punkt: indlæs en subsat Noto Sans
  efter behov på serveren og slå `pdf: true` til for sproget.


## Struktur

- Web/server: `src/i18n/messages/<sprog>/<navneområde>.json`. Ét navneområde pr. område (`auth`, `clients`, `invoices`, `emails`, `errors`, …).
  Nøgler er kamelskrift, grupperet logisk (`clients.form.nameLabel`). Navneområder må ikke overlappe mellem områder.
- `src/i18n/messages/load.ts`, `static.ts` og `src/i18n/catalogs/` er genereret. Efter at du har tilføjet en JSON-fil: `npm run i18n:build`.
- Kode, der også kører i browseren, importerer aldrig `staticMessages` (`src/i18n/static-catalog.ts`): den trækker alle statiske navneområder i alle sprog med ind i klientbundtet, også mails og notifikationer. Brug `catalogMessages` med navneområdets eget modul fra `src/i18n/catalogs/`, som `syncT`, `sharedT` og `pdfText` gør (`src/i18n/__tests__/static-catalog-split.test.ts` vogter dem).
- Browserudvidelsen har sit eget katalog i `browser-extension/src/i18n/`.
- `npm run i18n:check` kontrollerer kataloger (regler ovenfor) og at `load.ts`/`static.ts` er opdateret.
  `node scripts/i18n/check.mjs --report` viser dækning pr. sprog og hvor mange nøgler der mangler menneskelig korrektur.
- `node scripts/i18n/inventory.mjs src` tæller filer med hardcodet dansk tekst (grov heuristik).

## Sådan bruges oversættelser

Klientkomponent (`"use client"`):

```tsx
import { useTranslations } from "next-intl";
const t = useTranslations("clients");
<Button>{t("form.save")}</Button>;
t("list.count", { count: n }); // "{count, plural, one {# kunde} other {# kunder}}"
```

Servercomponent: `const t = await getTranslations("clients")` (`next-intl/server`).

Med `getTranslations({ locale, namespace })` bruger serveren instansens brand
eller et brand, der allerede er sat i kaldets kontekst. Det eksplicitte sprog
kan bruges ved statisk rendering, fordi opslaget hverken læser headers eller
cookies. På en delt multibrand-instans bruges `getTranslations("clients")`
uden `locale`, når både sprog og brand skal følge forespørgslen.

Udenfor React (tRPC-fejl, mails, PDF, eksport, cron): `const t = await getT("errors", locale?)` fra `@/i18n/server`.
Uden forespørgselskontekst (cron, tests, scripts) giver `getT` dansk, så eksisterende tekster og tests er uændrede.

Sider uden for dashboardet har ikke en klientudbyder. Pak dem ind i
`<NextIntlClientProvider messages={await getClientMessages("auth")}>` (`@/i18n/server`).

Dato, tal og valuta: brug `useLocale()` / `getLocale()` og `toIntlLocale(locale)` fra `@/i18n/format-locale`
i stedet for `"da-DK"`. Valutaen følger fakturaen (DKK, EUR, …), ikke brugerens sprog.

## Regler

1. Dansk tekst flyttes ordret til `da/…json`, så danske brugere ikke ser en ændring.
2. Én betydning, én nøgle. Ingen tekst sættes sammen af delsætninger; brug ICU-pladsholdere og `plural`.
3. Der er ingen sprogkode i URL'erne. Sproget vælges i Indstillinger (cookie + profil) og følger `Accept-Language` første gang.
4. Nye brugertekster skal have da og en; `npm run i18n:check` fejler ellers. De øvrige sprog læser engelsk, til de er oversat.
5. Tekst, som kun er data (kundenavne, projektnavne, fritekst), oversættes ikke.
6. Alle beta-sprog er maskinelle udkast, indtil nøglerne står i `src/i18n/messages/review-approved.json`.

## Serveren: fejl, eksporter og delt kode (navneområderne `server*`)

Tekster, der opstår på serveren (tRPC-fejl, API-svar, eksporter, delte hjælpere), bruger fire navneområder (de små `server*`- og `shared*`-navneområder, mails, PDF og notifikationer er "statiske": `staticNamespaces` i `scripts/i18n/catalogs.json`):

| Navneområde     | Indhold                                                                                                                                         | Hentes med                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `serverErrors`  | TRPCError- og API-beskeder, push-tekster                                                                                                        | `await tr("serverErrors", "clients.notFound")`                                               |
| `serverSync`    | Det samme, hvor der ikke kan bruges `await` (zod, valideringshjælpere, klientens venlige fejl, `src/lib/enterprise`, `src/lib/deadlines` m.fl.) | `st("zod.nameMin2")` (kun server) eller `syncT("key", values?, locale?)` (server og browser) |
| `serverExports` | README, tabelnavne og filoversigt i dataeksporten                                                                                               | `getTx("serverExports", locale)`                                                             |
| `serverMisc`    | Standardskabeloner til mail, afmeldingsside m.m.                                                                                                | `await tr("serverMisc", "...")`                                                              |

Sproget kommer fra den aktuelle tRPC-forespørgsel: `withLocale` i `src/lib/trpc/trpc.ts` læser cookien `locale`
(derefter `Accept-Language`) og sætter det i en `AsyncLocalStorage`, så `st`, `tr` og zod-beskeder følger det. Uden
forespørgselskontekst (cron, tests, scripts) er sproget dansk. Zod-beskeder skrives som
`z.string().min(2, { error: () => st("zod.nameMin2") })`, aldrig som en ren streng, fordi skemaet oprettes én gang
ved modul-indlæsning. Baggrundsjob med en bestemt modtager sender sproget eksplicit (`tr(ns, key, values, locale)`).

`src/i18n/__tests__/server-text.test.ts` kontrollerer, at hver besked i `server*` er gyldig ICU for alle sprog.

## Delt kode i lib/ (navneområderne `shared*`)

Små hjælpere i `src/lib` (formatering, rapportkolonner, plan-beskeder, eksportoverskrifter, hooks) bruger
`sharedT(namespace, key, values?, locale?)` fra `@/i18n/shared-text`. Den er synkron og virker både på server og i browser:
sproget er det eksplicitte, ellers tRPC-kaldets (`AsyncLocalStorage`), ellers browserens `html lang`, ellers dansk.

| Navneområde     | Indhold                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `sharedFormat`  | `formatTimeHuman`, `formatPause`, `formatCurrency`-suffikser, Ja/Nej, opdateringsprompten     |
| `sharedLabels`  | plan-/abonnementsbeskeder, helligdagsnavne, hooks-toasts, invitationsfejl, butiksabonnementer |
| `sharedReports` | rapportkolonner, PDF/CSV/XLSX-tekster, ressourceplan-eksport, enterprise-rapporteksport       |
| `sharedExport`  | overskrifter og sektioner i dataeksporten (CSV)                                               |

Mønstre:

- Konstanter, som tests og andre moduler sammenligner med (`BUSINESS_FEATURE_MESSAGE`, `ORGLESS_FORBIDDEN_MESSAGE`,
  `FREE_MEMBER_LOCKED_MESSAGE`), er uændret dansk. Kastesteder bruger funktionerne (`businessFeatureMessage()` m.fl.).
- `formatTimeHuman`, `formatCurrency`, `formatDate`, `formatReportCell` m.fl. tager et valgfrit `locale` og følger ellers
  det omgivende sprog. `dkkFormatter.format(n, locale?)` bevarer DKK.
- I asynkron serverkode (Better Auth-hooks, API-ruter) bruges `tr("sharedLabels", key, values, locale)`, som også finder
  forespørgslens sprog uden for tRPC.
- Rene danske data (helligdage fra `danishPublicHolidays`, standardnavnet "Fridag") oversættes ved visning med
  `localizeDayOffName`; brugerens egne fridagsnavne vises uændret.

## Brand name in texts

The catalogs say "TimeTrack" where a text names the product. `src/i18n/brandize.ts` swaps it to "TimeWren" when the
brand is not `timetrack` (`NEXT_PUBLIC_BRAND`, see `src/lib/brand-id.ts`), everywhere a catalog is turned into a
translator (`getT`, `mailT`, `sharedT`, `syncT`, PDF, `NextIntlClientProvider` messages). "TimeTrack Cloud" is the
hosted service and is kept. New text should still use `{brand}` where the name is passed in. The browser extension,
desktop and mobile catalogs keep their own brand handling and still contain the literal name (open item).
