import type { Node } from './ast-scanner';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributter, erFunktion, erKald, erMedlem, gaasMedStak, linje, navn, paa, parseKode, tekst, vaerk } from './ast-scanner';

/** Kilder under `src/` — porten læser dem, fordi den dømmer kode, den ikke renderer. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Navne på dansk (`pakker`, `rækker`) er almindelige her, og JavaScripts `\b`
 * kender kun ASCII — så `\bpakker\b` ville aldrig ramme. Derfor er `ORD` en
 * ordgrænse med `(?<![\w$])`, der holder: `æ` er ikke et `\w`, og `entries`
 * matcher stadig ikke `entries2`. Samme ordgrænse som `empty-state-error`.
 */
const ORD = (navn: string) => `(?<![\\w$])${navn}(?![\\w$])`;

/**
 * Tekst i `'` og `"` er indhold, ikke kode. Uden denne ville porten ramme den
 * danske sætning "Kunne ikke hente data." som et kald. Template-literals med
 * `${}` røres ikke, fordi de netop *er* kode.
 */
function udenStrenge(tekst: string): string {
  return tekst.replace(/'[^']*'|"[^"]*"/g, '""');
}

/**
 * Det kort der maler et tal fra et kald, og som derfor skal vide om kallet er
 * på vej. Kun `StatTile` har en `loading`-prop, så de øvrige tal-visere er
 * bevidst ikke her: `Meter`, `Badge` og `ListRow` dømmes af
 * `stat-tile-error.test.ts` for den *fejlede* variant, og de har ingen
 * indlæsningsprop at kræve.
 */
const VAERDI_VISER = new Set(['StatTile']);

type Kald = {
  /** Hvad fundet skal navngive, så en læser kan finde kallet i koden. */
  rapport: string;
  /** Matcher en læsning af kaldets data i en prop. */
  vaerdi: RegExp;
  /** Matcher navnet alene — i `entries.map(…)` er navnet netop læst. */
  navnAlene: RegExp;
  /** Matcher en afledt `const`, der flytter kaldets værdi videre. */
  vaerdiFlyttet: RegExp;
  /**
   * Matcher kaldets egen `isLoading`. For et navngivet kald er det
   * `pakker.isLoading`; for et destruktureret er det det løftede flagnavn, og
   * blikket bagud er nødvendigt — ellers rammer `flex.isLoading` et kald, der
   * handler om noget helt andet. Samme skeln som `stat-tile-error` på `isError`.
   */
  indlaeser: RegExp;
};

/** `const pakker = trpc.prepaid.list.useQuery(…)` — navnet bærer både værdien og svaret. */
function navngivetKald(egenKode: string): Kald[] {
  return Array.from(egenKode.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*trpc\.[\w$.]+\.useQuery\s*\(/g), ([, navn]) => ({
    rapport: navn,
    vaerdi: new RegExp(`\\b${navn}\\s*\\??\\.data\\b`),
    navnAlene: new RegExp(`\\b${navn}\\b`),
    vaerdiFlyttet: new RegExp(`\\b${navn}\\s*\\??\\.`),
    indlaeser: new RegExp(`\\b${navn}\\s*\\??\\.isLoading\\b`),
  }));
}

const DESTRUKTURERET = /const\s*\{([^}]*)\}\s*=\s*trpc\.([\w$.]+)\.useQuery[^;]*;/g;

/** Navnet en binding får i koden: `data`, `data: pakker` → `pakker`. */
function binding(bindinger: string, navn: string): string | undefined {
  for (const m of bindinger.matchAll(/([a-z_$][\w$]*)\s*(?::\s*([a-z_$][\w$]*))?/gi)) {
    if (m[1] === navn)
      return m[2] ?? navn;
  }
  return undefined;
}

/**
 * `const { data, isLoading, isError } = trpc.…` — værdien og svaret er løftet
 * Værdien og svaret er løftet *ud* af kallet og hedder begge
 * `data`/`isLoading`, så porten læser dem i mønsteret, ikke i navnet.
 */
function destruktureretKald(egenKode: string): Kald[] {
  const fund: Kald[] = [];
  for (const [, bindinger, procedure] of egenKode.matchAll(DESTRUKTURERET)) {
    const vaerdi = binding(bindinger, 'data');
    if (!vaerdi)
      continue;
    const indlaeser = binding(bindinger, 'isLoading');
    fund.push({
      rapport: `${vaerdi} (${procedure})`,
      vaerdi: new RegExp(`\\b${vaerdi}\\s*(\\?\\?|\\?\\.|\\.|\\[|\\()`),
      navnAlene: new RegExp(`\\b${vaerdi}\\b`),
      vaerdiFlyttet: new RegExp(`\\b${vaerdi}\\b`),
      // Uden `isLoading` i bindingen ved porten ikke, hvornår kallet er på
      // vej, så kallet dømmes — det samme argument som for `isError`.
      indlaeser: indlaeser
        ? new RegExp(`(?<!\\.)${ORD(indlaeser)}\\b\\s*(\\?\\?|\\?|\\.|&&|\\|\\||\\)|\\]|\\}|,|=)`)
        : /\bfindes_aldrig_i_koden\b/,
    });
  }
  return fund;
}

/**
 * Kaldene i én funktion, begge former. `resten` er koden uden destrukturerede
 * deklarationer: et `isLoading`, der kun står i deklarationen, er et flagnavn
 * og ikke en indlæsningstilstand.
 */
function kalde(egenKode: string): { kald: Kald[]; resten: string } {
  return {
    kald: [...navngivetKald(egenKode), ...destruktureretKald(egenKode)],
    resten: egenKode.replace(DESTRUKTURERET, ''),
  };
}

/**
 * Afledte `const` i samme funktion, transitivt: `const timer = … kald …` giver
 * ét niveau, `const iAlt = timer + 1` giver to. Det er værdien der flytter sig,
 * ikke kallet, så porten skal følge med.
 */
function afledte(egenKode: string, kald: Kald[], frø?: Map<string, Set<Kald>>): Map<string, Set<Kald>> {
  const afledt = new Map(frø ?? []);
  for (let runde = 0; runde < 12; runde++) {
    let ændret = false;
    for (const m of egenKode.matchAll(/const\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*([^;]+);/gu)) {
      const [, navn, rhs] = m;
      if (afledt.has(navn))
        continue;
      const kilder = new Set<Kald>();
      for (const k of kald) {
        if (k.vaerdiFlyttet.test(rhs))
          kilder.add(k);
      }
      for (const [afledtNavn, afledtKilder] of afledt) {
        if (new RegExp(ORD(afledtNavn)).test(rhs))
          afledtKilder.forEach(x => kilder.add(x));
      }
      if (kilder.size > 0) {
        afledt.set(navn, kilder);
        ændret = true;
      }
    }
    if (!ændret)
      break;
  }
  return afledt;
}

/** Navnene et bindingsmønster binder: `pkg` → `pkg`, `({ pkg })` → `pkg`. */
function bindingNavne(mønster: Node | undefined): string[] {
  if (!mønster)
    return [];
  if (mønster.type === 'Identifier')
    return [navn(mønster) ?? ''];
  if (mønster.type === 'ObjectPattern')
    return (vaerk<Node[]>(mønster, 'properties') ?? []).flatMap(el => bindingNavne(paa(el, 'value')));
  return [];
}

/** Kalde der *giver* et element videre. `reduce` er bevidst udeladt. */
const ITERERENDE = new Set(['map', 'filter', 'flatMap', 'forEach', 'sort']);

/**
 * Hvad en `.map`-callback får ind ad døren: parameterne og den samling den går
 * over. Uden denne så porten intet kald i `entries.data?.map(e => …)`.
 *
 * `stak` er hele kæden fra roden, så `stak[i - 1]` er callbackens eget kald —
 * samme node som `f.parent` var før.
 */
function itererede(kode: string, stak: Node[]): { navn: string; kilde: string }[] {
  const fund: { navn: string; kilde: string }[] = [];
  for (let i = 0; i < stak.length; i++) {
    const f = stak[i];
    if (f.type !== 'ArrowFunctionExpression' && f.type !== 'FunctionExpression')
      continue;
    const kald = i > 0 ? stak[i - 1] : undefined;
    if (!erKald(kald) || (vaerk<Node[]>(kald as Node, 'arguments') ?? [])[0] !== f)
      continue;
    const modtager = paa(kald as Node, 'callee');
    if (!erMedlem(modtager) || !ITERERENDE.has(navn(paa(modtager as Node, 'property')) ?? ''))
      continue;
    const kilde = tekst(kode, paa(modtager as Node, 'object'));
    for (const p of vaerk<Node[]>(f, 'params') ?? [])
      bindingNavne(p).forEach(navnlig => fund.push({ navn: navnlig, kilde }));
  }
  return fund;
}

/** Hvad der læses: en props-streng, en `.map`-samling, eller begge. */
type Laeser = { props: string; kilde: string | null };

/** De kald der føder en prop eller en `.map`-samling. */
function naaer({ props, kilde }: Laeser, kald: Kald[], afledt: Map<string, Set<Kald>>): Set<Kald> {
  const fundne = new Set<Kald>();
  for (const k of kald) {
    if (k.vaerdi.test(props))
      fundne.add(k);
  }
  for (const [navn, kilder] of afledt) {
    if (new RegExp(`[{(\\s,=]${ORD(navn)}`).test(props))
      kilder.forEach(k => fundne.add(k));
  }
  if (kilde !== null) {
    for (const k of kald) {
      if (k.navnAlene.test(kilde))
        fundne.add(k);
    }
    for (const [navn, kilder] of afledt) {
      if (new RegExp(ORD(navn)).test(kilde))
        kilder.forEach(k => fundne.add(k));
    }
  }
  return fundne;
}

/** Ét elements omgivende funktionsled: kalde, afledte `const` og koden uden deklarationer. */
type Kontekst = {
  kald: Kald[];
  /** Koden uden destrukturerede deklarationer, med `isLoading` endnu ubeskåret. */
  resten: string;
  egenKode: string;
  base: Map<string, Set<Kald>>;
};

/** Har elementet en prop med dette navn? */
function harProp(open: Node, navnlig: string): boolean {
  return attributter(open, n => n === navnlig).length > 0;
}

function scanSource(file: string, source: string): string[] {
  const funder: string[] = [];
  const cache = new Map<Node, Kontekst | null>();

  /**
   * Konteksten for ét elements yderste funktionsled. Reglen gælder *flere*
   * kalde i én komponent — ét kald har intet andet at vente på, så det er
   * `stat-tile-error`/`empty-state-error`, der dømmer det.
   */
  function kontekst(funktion: Node | undefined): Kontekst | null {
    // En funktion uden krop (`type F = () => void`) kan heller ikke have kald.
    if (!funktion || !erFunktion(funktion) || !paa(funktion, 'body'))
      return null;
    if (cache.has(funktion))
      return cache.get(funktion) ?? null;

    const egenKode = tekst(source, funktion);
    const { kald, resten } = kalde(egenKode);
    if (kald.length < 2) {
      cache.set(funktion, null);
      return null;
    }
    const k: Kontekst = { kald, resten, egenKode, base: afledte(egenKode, kald) };
    cache.set(funktion, k);
    return k;
  }

  gaasMedStak(paa(parseKode(source), 'program') as Node, (node, stak) => {
    if (node.type !== 'JSXSelfClosingElement' && node.type !== 'JSXOpeningElement')
      return;
    const egen = stak.filter(erFunktion);
    const k = kontekst(egen[0]);
    const tag = navn(paa(node, 'name')) ?? '';
    // To accepterede former: `loading={kald.isLoading}` på kortet selv, eller
    // kaldets `isLoading` rakt videre til en sektion/et barn, der maler sin
    // egen skeleton. Uden dem males kaldets værdi, mens serveren stadig ikke
    // har svaret — det er 6.28's fejlform.
    if (!k || !VAERDI_VISER.has(tag))
      return;
    // Frøene afhænger af *elementets* egen kæde, ikke af funktionens, så de
    // regnes pr. element: en `.map`-callback er kun med når den står i
    // kæden. Med dem i selve konteksten ville den første JSX-node i
    // funktionen have frosset dem væk for de senere.
    const frø = new Map<string, Set<Kald>>();
    for (const { navn: navnlig, kilde } of itererede(source, stak)) {
      const kilder = naaer({ props: '', kilde }, k.kald, k.base);
      if (kilder.size > 0)
        frø.set(navnlig, kilder);
    }
    const rå = tekst(source, node);
    const element = udenStrenge(rå);
    const naaerstaaende = naaer({ props: element, kilde: null }, k.kald, afledte(k.egenKode, k.kald, frø));
    // Koden *uden* elementets egne props. En `isLoading` på kortet selv er
    // form B, ikke en vagt — ellers ville `hint={expiring.isLoading ? …}`
    // dække en `value` der stod med `0`, fordi porten så kaldets flag et
    // sted i nærheden. Det er samme fejlform som 6.15's `isError`.
    const uden = udenStrenge(k.resten.includes(rå) ? k.resten.replace(rå, '') : k.resten);
    const uvedhovedede = [...naaerstaaende].filter((x) => {
      if (harProp(node, 'loading') && x.indlaeser.test(element))
        return false;
      return !x.indlaeser.test(uden);
    });
    if (uvedhovedede.length > 0)
      funder.push(`${file}:${linje(node)}  <${tag}> ${uvedhovedede.map(x => x.rapport).join(', ')}`);
  });
  return funder;
}

/**
 * Port mod en værdi, der males fra et kald, der endnu ikke har svaret —
 * opgave 6.29 (formen fra 6.28).
 *
 * `SectionState` venter på sektionens *primære* kald, og de sekundære kald
 * malte deres egen værdi, fordi de hverken stod i `isLoading` eller havde egen
 * `loading=`. Klippekort-kortene stod med `0` og «0 pakker inden 30 dage», og
 * ansættelseskortet med `0 t` overtid — altså en løgn om *intenting* udløber.
 *
 * Det er præcis den fejlform `stat-tile-error.test.ts` ikke kan se: den dømmer
 * `error=` og `ErrorState`, altså den *fejlede* variant — men et kald under
 * indlæsning har jo ingen fejl. Derfor er denne port en *parallel* dom, ikke en
 * udvidelse af den.
 *
 * Målingen før denne port fandt 21 komponenter med to eller flere kald. Den er
 * altså ikke bredere end opgaven: den dømmer pr. kald i en fler-kalds-komponent
 * og kun de kort, der maler et tal.
 *
 * Kendte grænser, så næste iteration ikke læser porten som en løsning:
 * - Værdier der males under en `isLoading`-betingelse (`kald.isLoading ?
 *   <ListSkeleton /> : …`) regnes som dækket, fordi `indlaeser` rammer
 *   betingelsen. Porten læser altså *at* kallet indgår i en betingelse, ikke at
 *   kortet ligger i den rigtige gren.
 * - Et kald, hvis `isLoading` rakt ned som prop (`<RateHistorySection
 *   isLoading={history.isLoading} />`), regnes som dækket. Om barnet så
 *   Om barnet så *maler* en skeleton er barnets ansvar — samme grænse som
 *   `stat-tile-error` har for rakt-ned-værdier.
 * - `useReportLoad(kald, …)` er en *melding* til skærmlæseren, ikke en
 *   tilstand, så den dækker intet her.
 * - Kun `StatTile` dømmes. `Badge`, `Meter` og `ListRow` har ingen
 *   `loading`-prop, så porten kan ikke kræve indlæsning af dem — de er
 *   `stat-tile-error`'s område for den *fejlede* variant. Under indlæsning er
 *   en tom `Badge`-tæller en påstand om nul, men den har ingen maskine at blive
 *   rettet med; det er et krav om en ny prop, ikke om en ny dom.
 */
describe('et tal må ikke vise sig for et kald, der er på vej', () => {
  it('finder ingen i src/', () => {
    const root = join(__dirname, '..');
    const funder = sourceFiles(root).flatMap(file => scanSource(file.replace(root, 'src'), readFileSync(file, 'utf-8')));

    expect(funder).toEqual([]);
  });

  /**
   * Porten dømmer *kun*, at der ikke er fund. Uden denne påstand er kæden
   * `sourceFiles(root) === [] ⇒ fund === [] ⇒ grøn`, så en glob der rammer
   * ingenting — testen flyttet et niveau ned, en rod der peger forkert — bliver
   * grøn, og gaten siger så til hver reviewer at appen overholder reglen.
   * Derfor dømmes dækningen for sig selv: et antal kilder, et antal skærme
   * (de filer porten er skrevet *for*) og en kendt fil fra UI-kittet, så en
   * forkert rod er rød frem for grøn.
   */
  it('finder kilder at kontrollere', () => {
    const root = join(__dirname, '..');
    const kilder = sourceFiles(root);
    expect(kilder.length).toBeGreaterThan(200);
    expect(kilder.filter(f => f.endsWith('-screen.tsx')).length).toBeGreaterThan(40);
    expect(kilder.some(f => f.endsWith(join('components', 'ui', 'button.tsx')))).toBe(true);
  });

  it('kan overhovedet se et tal fra et kald på vej', () => {
    // Porten skal kunne fejle. Uden denne test er "finder ingen" lige så sandt
    // for en port, der slet ikke læser noget.
    const kode = [
      'export function E() {',
      '  const profit = trpc.time.getProfitability.useQuery({});',
      '  const unbilled = trpc.time.unbilledStats.useQuery();',
      '  return (',
      '    <SectionState isLoading={profit.isLoading} isError={profit.isError} onRetry={profit.refetch}>',
      '      <StatTile label="Timer" value={formatHours(profit.data?.totalHours ?? 0)} />',
      '      <StatTile label="Ufaktureret" value={formatMoney(unbilled.data?.value ?? 0)} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:7  <StatTile> unbilled']);
  });

  it('lader et tal være, når kortet selv har loading=', () => {
    const kode = [
      'export function F() {',
      '  const profit = trpc.time.getProfitability.useQuery({});',
      '  const unbilled = trpc.time.unbilledStats.useQuery();',
      '  return (',
      '    <SectionState isLoading={profit.isLoading} isError={profit.isError} onRetry={profit.refetch}>',
      '      <StatTile label="Timer" value={formatHours(profit.data?.totalHours ?? 0)} />',
      '      <StatTile label="Ufaktureret" value={formatMoney(unbilled.data?.value ?? 0)} loading={unbilled.isLoading} error={unbilled.isError} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader et tal være, når kaldets isLoading er rakt videre', () => {
    // Samme målte form som `project-rates`: komponenten giver både data og
    // tilstand videre, og barnet maler sin egen skeleton.
    const kode = [
      'export function G({ projectId }: { projectId: string }) {',
      '  const history = trpc.rateHistory.getHistory.useQuery({ projectId });',
      '  const members = trpc.memberRates.listForProject.useQuery({ projectId });',
      '  return (',
      '    <View>',
      '      <RateHistorySection data={history.data} isLoading={history.isLoading} />',
      '      <MemberRatesSection data={members.data} isLoading={members.isLoading} />',
      '    </View>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('ser et tal gennem en afledt const', () => {
    const kode = [
      'export function H() {',
      '  const profit = trpc.time.getProfitability.useQuery({});',
      '  const unbilled = trpc.time.unbilledStats.useQuery();',
      '  const totalHours = (profit.data?.totalHours ?? 0) + (unbilled.data?.hours ?? 0);',
      '  return <StatTile label="Timer" value={formatHours(totalHours)} />;',
      '}',
    ].join('\n');
    // Begge kalde males i ét kort, og intet af dem har sagt fra
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:5  <StatTile> profit, unbilled']);
  });

  it('dømmer et destruktureret kald, hvis isLoading kun står i deklarationen', () => {
    // `isLoading` uden brug i koden er et flagnavn: porten ved ikke hvornår
    // kallet er på vej, så værdien skal dømmes. Samme argument som for `isError`.
    const kode = [
      'export function I() {',
      '  const { data: profit, isLoading } = trpc.time.getProfitability.useQuery({});',
      '  const { data: unbilled } = trpc.time.unbilledStats.useQuery();',
      '  return (',
      '    <SectionState isLoading={profitLoading} onRetry={() => {}}>',
      '      <StatTile label="Timer" value={formatHours(profit?.totalHours ?? 0)} loading={isLoading} />',
      '      <StatTile label="Ufaktureret" value={formatMoney(unbilled?.value ?? 0)} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:7  <StatTile> unbilled (time.unbilledStats)']);
  });
});
/**
 * De syntetiske tilfælde der dømmer *værdien gennem afledte `const`* — den
 * fejl, hvor porten læser `kald.data` i en prop, men `const timer = kald.data…`
 * står en linje længere væk. De er en samlet blok, fordi de deler det samme
 * spørgsmål: følger porten værdien eller kun kallet?
 */
describe('værdien der er flyttet en linje op', () => {
  it('følger en afledt const med dansk navn', () => {
    // Målt, ikke antaget: `\b` *kan* ramme `rækker` i `{String(rækker)}`, så
    // 6.18's konkrete hælde rammer ikke denne stilling. `ORD` er alligevel
    // ordgrænsen søster-porte bruger, fordi `\b` fejler når et navn grænser
    // op til et andet tegn — og testen låser danske navne fast, så et
    // skift tilbage til `\b` ikke kan ske uden at nogen mærker det.
    const kode = [
      'export function AG() {',
      '  const profit = trpc.time.getProfitability.useQuery({});',
      '  const unbilled = trpc.time.unbilledStats.useQuery();',
      '  const rækker = (unbilled.data?.count ?? 0) + 1;',
      '  return <StatTile label="Registreringer" value={String(rækker)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:5  <StatTile> unbilled']);
  });

  it('ser et tal i en listerække fra et sekundært kald', () => {
    const kode = [
      'export function J() {',
      '  const profit = trpc.time.getProfitability.useQuery({});',
      '  const packages = trpc.prepaid.list.useQuery({});',
      '  return (',
      '    <SectionState isLoading={profit.isLoading} onRetry={profit.refetch}>',
      '      {packages.data?.map(pkg => <StatTile key={pkg.id} label="Pakke" value={formatHours(pkg.remainingHours)} />)}',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:6  <StatTile> packages']);
  });
});

/**
 * Portens grænser: de steder den bevidst *ikke* dømmer. De er her, fordi en
 * afsluttende port uden dem læses som om den dækkede hele fejlformen — det var
 * 6.15–6.18's fejl i hver sin omgang.
 */
describe('portens grænser', () => {
  it('lader et tal være i en komponent med ét kald — det er en anden ports arbejde', () => {
    // Ét kald har intet andet at vente på, så `stat-tile-error` dømmer det.
    // Uden denne afgrænsning ville porten ramme hele appen.
    const kode = [
      'export function K() {',
      '  const unbilled = trpc.time.unbilledStats.useQuery();',
      '  return <StatTile label="Ufaktureret" value={formatMoney(unbilled.data?.value ?? 0)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader et tal være, når kallet indgår i en betingelse', () => {
    // Den målte form på to listerækker: `const isLoading = health.isLoading ||
    // alerts.isLoading` og `if (isLoading) …`. Begge kalde males derefter under
    // ÉN skeleton, så ingen af dem kan stå med sin egen værdi imens.
    const kode = [
      'export function N() {',
      '  const alerts = trpc.projects.getBudgetAlerts.useQuery();',
      '  const health = trpc.projects.healthStatus.useQuery();',
      '  if (health.isLoading || alerts.isLoading)',
      '    return <ListSkeleton rows={3} />;',
      '  return <View><StatTile label="Alarmer" value={String(alerts.data?.length ?? 0)} /></View>;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('ser ikke en mutation eller trpc.useUtils som et kald på vej', () => {
    // Den målte falske positive fra 6.17: `trpc.useUtils()` har ingen data at
    // vise, og en mutations `data` er resultatet af sidste kørsel.
    const kode = [
      'export function L() {',
      '  const utils = trpc.useUtils();',
      '  const onDone = async () => { await utils.time.invalidate(); };',
      '  const save = trpc.time.create.useMutation({ onSuccess: onDone });',
      '  const unbilled = trpc.time.unbilledStats.useQuery();',
      '  const profit = trpc.time.getProfitability.useQuery({});',
      '  return <StatTile label="Ufaktureret" value={save.isPending ? "–" : formatMoney(unbilled.data?.value ?? 0)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:7  <StatTile> unbilled']);
  });

  it('ser ikke et dansk ord i en tekst som et kald', () => {
    const kode = [
      'export function M() {',
      '  const profit = trpc.time.getProfitability.useQuery({});',
      '  const unbilled = trpc.time.unbilledStats.useQuery();',
      '  return (',
      '    <SectionState isLoading={profit.isLoading} onRetry={profit.refetch}>',
      '      <StatTile label="Kunne ikke hente data." value="0 kr." />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });
});
