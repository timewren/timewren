# TimeTrack Linear-design — referenceguide

Denne guide definerer det "Linear-inspirerede" design som hele dashboardet konverteres til.
Guldstandard-sider (læs dem før du redesigner noget):

- `src/app/dashboard/klippekort/page.tsx` — liste-side: stats strip + pill tabs + flex-tabel
- `src/app/dashboard/reports/page.tsx` + `src/app/dashboard/reports/_components/` — toolbar, stats strip, paneler
- `src/app/dashboard/clients/page.tsx` — liste med pill-filtre
- `src/app/dashboard/tasks/[id]/page.tsx` — detalje-side: 2-kolonne layout med tabs
- `src/components/dashboard/widgets/` — widget/kort-stil

## Grundprincipper

1. **Kompakt og roligt** — små skrifter (text-xs/text-sm), tæt spacing, ingen store farvede headers eller gradients.
2. **Ingen skygger på kort** — `rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900`. Aldrig `shadow-md`/`shadow-lg` (kun `shadow-sm` på aktiv pill og dropdowns/modaler).
3. **Dark mode overalt** — hver eneste farveklasse skal have en `dark:`-variant. Baggrunde: `bg-white dark:bg-gray-900`, borders: `border-gray-200 dark:border-gray-800`, tekst: `text-gray-900 dark:text-white` / `text-gray-500 dark:text-gray-400`.
4. **Tal er monospace** — alle tal/beløb/timer: `font-mono tabular-nums`.
5. **Danske UI-tekster** bevares uændret medmindre de er åbenlyst forkerte.
6. **Kun visuelt** — ingen ændringer i tRPC-kald, datalogik eller routing. Funktionalitet skal være 1:1 efter redesign.

## Byggeklodser (kopiér disse mønstre)

### Sidehoved

Brug altid `PageHeader` fra `@/components/dashboard-nav`:
```tsx
<PageHeader title="…" description="…" helpTopicId="…" actions={<Button …/>} />
```

### Stats strip (liste-/oversigtssider med nøgletal)

```tsx
<div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden">
  <div className="bg-white dark:bg-gray-900 p-4">
    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      Label
    </div>
    <div className="text-2xl font-bold font-mono tabular-nums text-gray-900 dark:text-white mt-1">
      42
    </div>
    {/* valgfri undertekst: text-xs text-gray-500 dark:text-gray-400 mt-0.5 */}
  </div>
  …
</div>;
```
Advarsel-metrikker farves `text-amber-600 dark:text-amber-400` (eller rød ved kritisk).

### Pill-filter tabs (erstatter dropdowns/checkboxes til statusfiltre)

```tsx
<div className="flex gap-1 flex-wrap">
  <button
    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
      active
        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
    }`}
  >
    Label {count > 0 && `(${count})`}
  </button>
</div>;
```

### Søgefelt + sort-dropdown

```tsx
<div className="relative flex-1 max-w-sm">
  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
  <input className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-9 pr-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20" />
</div>
<select className="appearance-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-3 pr-8 py-1.5 text-sm text-gray-700 dark:text-gray-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20">…</select>
```

### Kompakt flex-tabel (erstatter card-grids og gamle `<table>`)

```tsx
<div role="table" className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
  {/* header-række */}
  <div role="row" className="flex items-center px-6 py-2 border-b border-gray-200 dark:border-gray-800 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
    <div role="columnheader" className="flex-[2.5]">Navn</div>
    <div role="columnheader" className="flex-1 text-center hidden sm:block">Status</div>
    …
  </div>
  {/* data-række — klikbar via <Link role="row"> */}
  <Link role="row" href={…} className="flex items-center px-6 py-3 border-b border-gray-100 dark:border-gray-800/50 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
    <div role="cell" className="flex-[2.5] min-w-0 pr-3">
      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">Primær</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">Sekundær</div>
    </div>
    …
  </Link>
</div>
```

- Kolonner skjules responsivt med `hidden sm:block` / `hidden md:block` / `hidden lg:block` (mindst vigtige først).
- Rækker med advarsel: venstre accent `border-l-[3px] border-l-amber-500` (rød ved fejl/kritisk).
- Actions i sidste kolonne: ···-knap (`MoreHorizontal`) der åbner dropdown-menu; selve rækken navigerer til detaljesiden.

### Inline progress bar

```tsx
<div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
  <div
    className="h-1.5 rounded-full transition-all duration-500 bg-blue-500"
    style={{ width: `${pct}%` }}
  />
</div>;
```
Fyld: blå normalt, `bg-amber-500` ved ≥75 %, `bg-red-500` ved ≥90 %.

### Status-badges

```tsx
<span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
  Aktiv
</span>;
```
Farver: grøn=aktiv/ok, amber=advarsel, rød=fejl/udløbet, grå=arkiveret/inaktiv, blå=info/i gang.

### Kort/sektioner på detalje- og settings-sider

```tsx
<div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
  <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
    Sektionstitel
  </h2>
  …
</div>;
```
Settings-sider: sektioner som disse kort; labels `text-xs font-medium text-gray-700 dark:text-gray-300`; inputs som søgefelt-recepten ovenfor.

### Formularer (new/edit-sider)

- Behold React Hook Form + Zod-logikken urørt.
- Felter i kort-sektioner som ovenfor, max-bredde `max-w-2xl`.
- Primær-knap: eksisterende `Button` fra `@/components/ui`. Sekundær/annullér: ghost-stil.

### Modaler/dialoger

- Brug eksisterende dialog-komponenter fra `@/components/ui`, men indhold følger samme regler: ingen gradients, `rounded-xl`, kompakte overskrifter (`text-sm font-semibold`), dark mode-komplet.
- `ConfirmDialog` fra `@/components/ui` til bekræftelser — ikke hjemmelavede confirm-bokse.

### Empty states

```tsx
<div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
  <Icon className="h-8 w-8 text-gray-300 dark:text-gray-600 mb-3" />
  <p className="text-sm font-medium text-gray-900 dark:text-white">Ingen …</p>
  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
    Forklaring + evt. CTA
  </p>
</div>;
```

### Loading

`<InlineSpinner className="h-6 w-6" />` centreret i `py-16` — ingen store skeleton-vægge medmindre siden allerede har gode skeletons.

## Anti-mønstre (fjern når du ser dem)

- `shadow-md`/`shadow-lg`/`shadow-xl` på kort
- Gradient-headers, store farvede hero-bokse, `text-3xl`-titler inde på siden (PageHeader klarer titlen)
- Card-grids hvor en tabel er bedre (lister over ensartede entiteter)
- shadcn `<Card><CardHeader><CardTitle>` med stor padding — erstat med kort-recepten
- Manglende `dark:`-varianter
- Emojis i UI
- Checkbox-/dropdown-filtre til status → pill tabs
