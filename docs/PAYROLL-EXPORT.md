# Løneksport — format og mapping (E5, #463)

TimeTrack oversætter registrerede timer, fravær, overtid, flex og
pausefradrag til lønsystemets **lønarter** og eksporterer én flad fil pr.
lønperiode: _antal pr. lønart pr. medarbejder_. Filen er deterministisk —
samme data og samme regler giver altid samme fil.

Opsætning: **Enterprise → Indstillinger → Løn og lønarter**
(`/dashboard/enterprise/settings/payroll`). Eksport: samme side, eller
rapportbyggeren (**Rapporter → Lønrapport → Lønart-fordeling**).

## Datamodel

| Tabel / felt                                                | Betydning                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `organizations.payroll_system`                              | `generic` \| `sd` \| `kmd` \| `sls` \| `danloen` \| `dataloen` — vælger fillayout                |
| `organizations.payroll_period_type`                         | `month` \| `biweekly`                                                                            |
| `organizations.payroll_period_start_day`                    | Skæringsdag 1–28 (1 = kalendermåned; 16 = 16/x–15/x+1, perioden hører til måneden den slutter i) |
| `employee_profiles.employee_number`                         | Medarbejdernummer i lønsystemet (unik pr. org, CPR-frit)                                         |
| `employee_profiles.external_payroll_id`                     | Valgfrit eksternt id (SD: tjenestenummer)                                                        |
| `payroll_wage_types`                                        | Lønart: `code`, `name`, `unit` (`hours`/`days`), `kind` (`time`/`absence`/`supplement`)          |
| `payroll_mapping_rules`                                     | Kilde → lønart med valgfri type, dagsbetingelse og prioritet                                     |
| `activity_types.payroll_code`, `absence_types.payroll_code` | Fallback-kode når ingen regel matcher                                                            |

Alt er org-scopet og arkiveres frem for at slettes.

## Mapping-regler

Kilder: `activity` (timer pr. aktivitetstype), `absence` (fraværsdage pr.
fraværstype), `overtime_earned`, `overtime_used` (afspadsering),
`overtime_paid_out`, `flex_positive`, `flex_negative`, `break_deduction`.

En regel matcher når kilden passer, typen passer (specifik aktivitets-/
fraværstype eller _alle typer_) og dagsbetingelsen passer (`any`,
`weekend`, `holiday`, `weekend_or_holiday` — helligdage fra org'ens
helligdagskalender).

Afgørelse pr. fakta:

1. Kandidater sorteres på `priority` (lavest først); ved lighed vinder den
   mest specifikke (bestemt type > alle typer; dagsbetingelse > alle dage).
2. Første kandidat hvis lønart **ikke** er et tillæg bliver grundlønarten
   (eksklusiv — kun én).
3. Alle matchende regler til lønarter af typen **tillæg** giver en ekstra
   linje oven på grundlønarten (fx weekendtillæg + normaltimer). Én linje
   pr. tillægs-lønart.
4. Ingen regel → typens `payroll_code` (timer for aktivitet, dage for
   fravær). Ingen kode → faktaen lander i "Ikke mappet" og **kommer ikke
   med i filen**. Overtid uden regel er også "ikke mappet". Flex og
   pausefradrag eksporteres kun når en regel findes.

Antal: `unit = hours` → timer, `unit = days` → dage (fraværsdage er 1, 0,5
eller timer/dagsnorm — samme udfoldning som rapporterne). Afrunding til to
decimaler sker **efter** summering pr. medarbejder × lønart.

Grundlaget er rapport-datasættet (E4): afviste timer er ekskluderet,
fravær tæller kun godkendte anmodninger, fratrådte medarbejdere kun ved
tilvalg. Datasættet er aldrig trunkeret.

## Faldgruber — læs før opsætning

- **Overtid vs. flex — mapp kun én af dem.** Aktivitetstimer eksporteres
  brutto (alle registrerede timer). `overtime_earned` og `flex_positive`
  er begge _afledt_ af de samme registreringer (timer ud over normen).
  Mapper du både aktivitet, overtid og flex, eksporteres de overskydende
  timer flere gange. Anbefalet: aktivitet → grundlønart, og derudover
  ENTEN `overtime_paid_out`/`overtime_used` (når overtidsmodulet bruges)
  ELLER flex — aldrig `overtime_earned` og `flex_positive` samtidig.
- **Overtid dateres på ugestart.** Overtidsfakta udvælges på
  registreringstidspunktet (`createdAt`) men dateres på `weekStart`
  (præeksisterende adfærd i rapportlaget). Dagsbetingelser (weekend/
  helligdag) matcher derfor ikke meningsfuldt på overtidskilder — brug
  "Alle dage" på dem.
- **CSV og XLSX beskytter mod regnearksformler.** Tekst der begynder
  med `=`, `+`, `-`, `@`, tabulator eller carriage return får en apostrof
  foran. Formelpræfikser efter indledende blanktegn beskyttes også.
  Tal, herunder negative beløb, beholder deres eksisterende format.
  CSV-felter med carriage return citeres ligesom felter med linjeskift.

## Fillayout

CSV: UTF-8 med BOM, semikolon-separeret, decimalkomma, CRLF. Én række pr.
(medarbejder, lønart, enhed). Excel-varianten (`.xlsx`) har samme kolonner
med tal som tal.

### `generic` (og kmd / sls / danloen / dataloen)

```
Medarbejdernr;Lønart;Antal;Enhed;PeriodeStart;PeriodeSlut;Navn;Lønartnavn;Afdeling;EksterntId
1001;0100;148,00;T;2026-08-01;2026-08-31;Mette Jensen;Normaltimer;Værksted;
1001;0300;2,00;D;2026-08-01;2026-08-31;Mette Jensen;Sygdom;Værksted;
```

- `Enhed`: `T` = timer, `D` = dage.
- Datoer ISO (`YYYY-MM-DD`).
- Kolonnerne 7–10 er informative og kan ignoreres af importen.

KMD Opus, SLS, Danløn og DataLøn bruger dette layout **indtil formatet er
verificeret mod lønkontorets importspecifikation** — de fleste systemer
importerer en flad "medarbejdernr;lønart;antal"-fil via en importskabelon.
SLS' OIO-XML er ikke implementeret.

### `sd` (SD Løn)

```
Tjenestenummer;Lønart;Antal;Enhed;Fra dato;Til dato;Navn
00012345;0100;148,00;T;01-08-2026;31-08-2026;Mette Jensen
```

- `Tjenestenummer` = `external_payroll_id`, fallback `employee_number`.
- Datoer `DD-MM-YYYY`.

## Advarsler ved eksport

- **Mangler medarbejdernummer**: rækken eksporteres med tom
  `Medarbejdernr` — UI'et lister navnene før download.
- **Ikke mappet**: kilde/type og antal vises; intet eksporteres for dem.

Hver eksport logges i org'ens hændelseslog (`payroll_exported`: periode,
format, lønsystem, antal linjer og medarbejdere).

## Ikke med i denne version

- Låst lønkørsel (`payroll_runs` med snapshot og periodelås) — eksporten
  er genkørbar; låsning kommer som opfølgning.
- Satser/beløb — kun antal. Lønsystemet bærer satserne.
- SLS OIO-XML.
