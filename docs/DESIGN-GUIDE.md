# App-design: tekniske mønstre

Denne fil beskriver kun de app-tekniske mønstre i web-appen: spacing, komponenter, tilstande og dashboardet. Brand, navn, farver, typografi, logo, tone og hjørneradius står i [`BRAND.md`](BRAND.md), som er sandheden. Er der modstrid, gælder `BRAND.md`.

Brand-delen (navneforslag, blå palette, Inter, slogans og positionering) blev fjernet 12/10-2026 under rebrandet (issue #825, fase 10).

## Spacing

8-punkts grid (Tailwinds standardskala):

```css
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-6: 24px
--space-8: 32px
--space-12: 48px
--space-16: 64px
```

## Komponenthierarki

**Navigation**
- Sidebar med sektioner, der kan foldes sammen
- Brødkrummer på dybe sider
- Kommandopaletten (`cmdk`, Cmd/Ctrl+K) som primær søgning

**Kort**
- Hjørneradius efter `BRAND.md` → Layout (kort og vinduer 14 px, knapper og inputs 8 px)
- Skygge kun på det ene element, der skal løftes

**Formularer**
- Tydelige labels over felterne
- Validering i feltet (React Hook Form + Zod)
- Trinviser ved forløb med flere trin

## Tilstande

**Knapper**
- Standard: udfyldt baggrund
- Hover: lidt mørkere (`--tt-gran-moerk` på brandknapper)
- Aktiv: mørkere
- Deaktiveret: 50 % opacitet og `cursor: not-allowed`
- Fokus og trykflader: se `BRAND.md` → Kanter, fokus og trykflader

**Datavisning**
- Enkle grafer uden pynt
- Faste farver for samme betydning på tværs af sider
- Tooltips ved hover
- Detaljer vises først, når brugeren beder om dem

## Dashboardet

### Informationsarkitektur

Det vigtigste skal kunne ses på fem sekunder:
- Omsætning i den aktuelle måned
- Klippekort: hvor mange timer der er tilbage (visning efter `BRAND.md` → Klippekortet: regler)
- Dagens opgaver
- Seneste aktivitet

### Widgets

Brugeren kan selv sætte dashboardet sammen af widgets i `src/components/dashboard/widgets/`, fx:
- Klippekort-status og klippekort med lav saldo (`PrepaidStatusWidget`, `LowBalancePackagesWidget`)
- Ufaktureret tid (`UnbilledTimeWidget`)
- Omsætning pr. kunde (`RevenueByClientWidget`)
- Seneste aktivitet (`RecentActivityWidget`)
- Projektstatus (`ProjectHealthWidget`)
- Kommende opgaver og deadlines (`UpcomingTasksWidget`, `UpcomingDeadlinesWidget`)

### Mobil

- Trykflader mindst 44 × 44 px
- Navigation, der kan foldes sammen
- PWA-optimeret

## Datavisualisering

- Søjle- og linjediagrammer som udgangspunkt
- Statusfarver (succes, advarsel, fejl) betyder det samme overalt. Brandfarven bruges til neutrale serier, ikke blå.
- Hover og mulighed for at klikke sig ned i tallene
- Ingen dekoration, der ikke siger noget om data

## Ikoner

Lucide, outline, 1,5 px streg. 24 px som standard og 16 px i kompakte visninger. Kun hvor ikonet hjælper med at genkende noget (se `BRAND.md` → Ikoner).

## Tal og tid i UI

Notation, `tabular-nums` og saldo som "tilbage" følger `BRAND.md` → Tal, priser og tid ("2 t 15 min", "7,5 t", "7 t tilbage af 20").
