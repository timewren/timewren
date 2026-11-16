import type { Element, Node } from './ast-scanner';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributter, erFunktion, erKald, erMedlem, gaasMedStak, linje, navn, paa, parseKode, selvlukket, tekst, vaerk } from './ast-scanner';

/** Kilder under `src/` — porten læser dem, fordi den dømmer kode, den ikke renderer. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function hasProp(open: Element, navnlig: string): boolean {
  return attributter(open, n => n === navnlig).length > 0;
}

/**
 * Tekst i `'` og `"` er indhold, ikke kode. Uden denne ville porten ramme den
 * danske sætning "Kunne ikke hente data." som et kald — og fundet så ud som
 * om det skulle rettes i koden. Template-literals med `${}` røres ikke, fordi
 * de netop *er* kode.
 */
function udenStrenge(tekst: string): string {
  return tekst.replace(/'[^']*'|"[^"]*"/g, '""');
}

/** Den prop der skal dømmes: `ListRow`s højre side, ellers hele rækken af props. */
function judgedProps(kode: string, open: Element, tag: string): string {
  return udenStrenge(attributter(open, n => tag !== 'ListRow' || n === 'right')
    .map(p => tekst(kode, p))
    .join(' '));
}

/**
 * Komponenter der viser et TAL fra et kald: et nøgletal, en bjælke, en
 * tæller-chip eller en rækkes højre side. Listen er bevidst komponenternes
 * rolle, ikke deres navn — men de skal findes, ellers dømmer porten kun de
 * steder den kender (findet fra reviewen 30/9 13:40).
 *
 * `ProgressBar` fandt sig ikke i `src/` ved målingen 30/9: bjælken hedder
 * `Meter` (`features/home/components/meter.tsx`). Den er derfor med her, så
 * en fremtidig meter uden fejltilstand bliver dømt.
 */
const TAL_VISER = new Set(['StatTile', 'Meter', 'Badge', 'ListRow']);

/**
 * Findene i en kildefil som `fil:linje  <StatTile> flex` — de steder der viser
 * et tal fra et kald uden at sige, at tallet aldrig kom.
 *
 * Et element er dømt når det læser et `trpc`-kalds data, kaldet er i *samme
 * funktion*, og kaldet hverken får `error=` eller males af en
 * `ErrorState`/`SectionState` der læser netop *dets* `isError`.
 *
 * Værdien følges gennem afledte `const`: `const timer = (kald.data ?? [])…`
 * og derefter `value={formatHours(timer)}` er præcis samme fejlform som
 * `value={formatHours(kald.data?.total ?? 0)}`, bare en linje længere væk.
 */
function naaerKald(props: string, kald: Kald[], afledt: Map<string, Set<Kald>>): Set<Kald> {
  const naaer = new Set<Kald>();
  for (const k of kald) {
    if (k.vaerdi.test(props))
      naaer.add(k);
  }
  for (const [navn, kilder] of afledt) {
    if (new RegExp(`[{(\\s,=]${navn}\\b`).test(props))
      kilder.forEach(k => naaer.add(k));
  }
  return naaer;
}

/**
 * Ét kald porten dømmer, uanset hvilken form `useQuery` blev skrevet i. Begge
 * former skal give et kald — ellers dømmer porten kun de steder den kender,
 * og det var netop 6.16's fund (se `describe`-blokken nedenfor).
 */
type Kald = {
  /** Hvad fundet skal navngive, så en læser kan finde kallet i koden. */
  rapport: string;
  /** Matcher en prop, der læser kaldets værdi. */
  vaerdi: RegExp;
  /** Matcher en afledt `const`, der flytter kaldets værdi videre. */
  vaerdiFlyttet: RegExp;
  /** Matcher kaldets egen `isError` — i props eller i en malet fejltilstand. */
  svar: RegExp;
  /**
   * Matcher navnet alene. Det bruges kun på den samling en `.map` går over,
   * hvor `pakker` *er* en læsning af kaldets data — der er hverken `.` eller
   * `??` at kræve, som der er i en prop.
   */
  samling: RegExp;
};

/**
 * Regex der aldrig rammer. Et destruktureret kald uden `isError` i sin egen
 * binding kan ikke frikendes af en malet fejltilstand: porten ved ikke
 * hvornår kallet fejler, så tallet skal dømmes.
 */
function aldrig(): RegExp {
  return /\bfindes_aldrig_i_koden\b/;
}

/**
 * `const flex = trpc.…useQuery()` — kaldets navn bærer både værdien og
 * svaret.
 *
 * Kun `useQuery` er et kald. `trpc.useUtils()` har ingen data at vise, og en
 * mutations `data` er resultatet af sidste kørsel, ikke et tal der fejlede at
 * hente — 6.17 målte, at porten ellers dømte `security-screen`, fordi
 * `const utils = trpc.useUtils()` så ud som et kald, og en mutation der så
 * ud som en afledt `const` af det.
 */
function navngivetKald(egenKode: string): Kald[] {
  return Array.from(egenKode.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*trpc\.[\w$.]+\.useQuery\s*\(/g), ([, navn]) => ({
    rapport: navn,
    vaerdi: new RegExp(`\\b${navn}\\s*\\??\\.data\\b`),
    vaerdiFlyttet: new RegExp(`\\b${navn}\\s*\\??\\.`),
    svar: new RegExp(`\\b${navn}\\s*\\??\\.isError\\b`),
    samling: new RegExp(`\\b${navn}\\b`),
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
 * `const { data, isError, refetch } = trpc.…` — her står værdien og svaret
 * løftet *ud* af kaldet og hedder begge `data`/`isError`, så porten skal læse
 * dem i mønsteret, ikke i navnet. En omdøbt binding følger sit eget navn;
 * uden det ville porten dømme tal, der slet ikke læser kallet.
 *
 * `vaerdi` kræver, at navnet *læses* (medlem, indeks, `??` eller som
 * argument): en nøgen `data` ville ramme den danske sætning "Kunne ikke
 * hente data." i en tekst-prop. I en `const` er den fare ikke til stede, så
 * `vaerdiFlyttet` tager det nøgne navn. Samme krav gælder `svar`, dog med et
 * blik bagud: ellers rammer attributet `isError={flex.isError}` — og værdien
 * `flex.isError` — et kald, der handler om noget helt andet.
 */
function destruktureretKald(egenKode: string): Kald[] {
  const fund: Kald[] = [];
  for (const [, bindinger, procedure] of egenKode.matchAll(DESTRUKTURERET)) {
    const vaerdi = binding(bindinger, 'data');
    if (!vaerdi)
      continue;
    const svar = binding(bindinger, 'isError');
    fund.push({
      rapport: `${vaerdi} (${procedure})`,
      vaerdi: new RegExp(`\\b${vaerdi}\\s*(\\?\\?|\\?\\.|\\.|\\[|\\()`),
      vaerdiFlyttet: new RegExp(`\\b${vaerdi}\\b`),
      svar: svar ? new RegExp(`(?<!\\.)\\b${svar}\\b\\s*(\\?\\?|\\?|\\.|&&|\\|\\||\\)|\\]|\\})`) : aldrig(),
      samling: new RegExp(`\\b${vaerdi}\\b`),
    });
  }
  return fund;
}

/**
 * Kaldene i én funktion, begge former. `resten` er koden uden destrukturerede
 * deklarationer: et `isError`, der kun står i deklarationen, er et flagnavn
 * og ikke en fejltilstand.
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
 * ikke kaldet, så porten skal følge med.
 *
 * `frø` er navne, porten ikke selv kan regne ud — en `.map`-parameters
 * betyder ingenting uden den samling, der går over den.
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
        if (new RegExp(`(?<![\\w$])${afledtNavn}(?![\\w$])`).test(rhs))
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

/**
 * Kalde der *giver* et element videre. `reduce` er bevidst udeladt: der er
 * første parameter en løbende sum, ikke et element fra samlingen, så den bærer
 * ikke samlingens værdi.
 */
const ITERERENDE = new Set(['map', 'filter', 'flatMap', 'forEach', 'sort']);

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

/**
 * Hvad en `.map`-callback får ind ad døren: parameterne og den samling den
 * går over. Uden denne så porten ingen kald, fordi et element i en listerække
 * lever i en callback, hvor `trpc`-kallet — og dets `isError` — ikke står.
 * Det var 6.16's næste kendte hul, målt som `prepaid-card`.
 *
 * `stak` er hele kæden fra roden, så `stak[i - 1]` er callbackens kald —
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

/**
 * Hvilke kald der føder en samling. Her nødvendiggør navnet sig selv — det er
 * den samling, der gås over — så kravet om `{`, `(` eller `=` foran navnet i
 * `naaerKald` gælder ikke: i `packages.map(…)` er `packages` netop læst.
 */
function naaerSamling(kilde: string, kald: Kald[], afledt: Map<string, Set<Kald>>): Set<Kald> {
  const naaer = new Set<Kald>();
  for (const k of kald) {
    if (k.samling.test(kilde))
      naaer.add(k);
  }
  for (const [navn, kilder] of afledt) {
    if (new RegExp(`(?<![\\w$])${navn}(?![\\w$])`).test(kilde))
      kilder.forEach(k => naaer.add(k));
  }
  return naaer;
}

function scanSource(file: string, source: string): string[] {
  const funder: string[] = [];

  gaasMedStak(paa(parseKode(source), 'program') as Node, (node, stak) => {
    const egen = stak.filter(erFunktion);
    // Kun selvlukkede elementer: `TAL_VISER`-komponenterne er kort i koden,
    // så en `<StatTile …>…</StatTile>` med børn er en *anden* komponent.
    const element = selvlukket(node);
    if (!element)
      return;
    const tag = navn(paa(element, 'name')) ?? '';
    if (!TAL_VISER.has(tag))
      return;
    const props = judgedProps(source, element, tag);

    // Kalde, afledte `const` og malet fejltilstand læses i det YDERSTE
    // funktionsled. Et element i en `.map`-callback lever i en indre
    // funktion, men værdien kommer fra et kald i den ydre — så kun den
    // indre kode gjorde, at porten dømte de steder den kendte.
    const egenKode = tekst(source, egen[0]);

    const kald = kalde(egenKode);
    const frø = new Map<string, Set<Kald>>();
    const base = afledte(egenKode, kald.kald);
    for (const { navn: navnlig, kilde } of itererede(source, stak)) {
      const kilder = naaerSamling(kilde, kald.kald, base);
      if (kilder.size > 0)
        frø.set(navnlig, kilder);
    }
    const naaer = naaerKald(props, kald.kald, afledte(egenKode, kald.kald, frø));

    // Ét kald der males af en fejltilstand dækker hele skærmen: den viser
    // `ErrorState` i stedet for rækken. Det gælder kun den funktion, der
    // laver `ErrorState` — ikke hele filen — og det gælder pr. kald, så et
    // hængende nabo-kald ikke dækker sit eget tal.
    const maler = /ErrorState|SectionState/.test(egenKode);
    const uvedhovedede = [...naaer].filter(k => !hasProp(element, 'error') && !k.svar.test(props)
      && !(maler && k.svar.test(kald.resten)));
    if (uvedhovedede.length > 0)
      funder.push(`${file}:${linje(node)}  <${tag}> ${uvedhovedede.map(k => k.rapport).join(', ')}`);
  });
  return funder;
}

/**
 * Port mod et tal der ligner rigtige data, men kommer fra et kald der
 * fejlede — opgave 6.14 (kort) og 6.15 (formen).
 *
 * Fundet fra reviewen 30/9 13:40 var præcis denne fejlform: en regel der dømmer
 * de steder den kender. `screenLoad` siger "Indhold indlæst", fordi ét kald i
 * stopket ikke fejlede, mens et andet viser `0,0 t`. De ni regioner fik egen
 * `ErrorState`, men de ti nøgletal, der folder *flere* kald ind i ét kort, blev
 * ikke set af nogen port — de ligger under en `SectionState`, der dækker et
 * andet kald end det kortet viser.
 *
 * 6.15 målte den samme fejlform *uden* for `StatTile` — `Badge`-tællere,
 * `ListRow`s højre side og bjælken. Målingen fandt **nul** steder: R5 og 6.14
 * dækkede dem alle, fordi de gik gennem `ErrorState`/`error=`. Så i stedet for
 * at lappe kode lukkede den porten de to huller, den selv havde:
 *
 * 1. **Afledte `const`** (`const timer = (kald.data ?? [])…` → `value={…timer}`).
 *    Før læste porten kun props, der nævner `kald.data` direkte, så en værdi
 *    der var flyttet én linje op var usynlig for den.
 * 2. **Pr. kald, ikke pr. funktion.** Før slap ét kald med `isError` + ét
 *    `ErrorState` i samme funktion *alle* tal i den funktion, også tal fra et
 *    andet kald uden `isError`. Nu skal hvert kald have sit eget.
 *
 * Bevidst IKKE dømt: elementer der får værdien rakt ned som prop
 * (`StatsTiles`, `ClientStatsSection`) er forældrenes ansvar, fordi det er
 * forældrenes `ErrorState` der maler det hele. Samme grænse som før.
 *
 * 6.16 lukkede det næste kendte hul: porten læste kun `const flex = trpc.…`
 * og så slet ikke `const { data, isError } = trpc.…`, hvor værdien og svaret er
 * løftet ud af kallet og hedder begge `data`/`isError`. Målt i `src/`: 245
 * navngivne mod 5 destrukturerede, så hullet var lille, men helt. Målingen
 * fandt **nul** steder — de fem maler hver deres egen `ErrorState` — så det
 * var porten, ikke koden, der blev rettet.
 *
 * 6.17 lukkede det tredje: porten læste kun `const` på funktionsniveau, så et
 * element i en `.map`-callback (`packages.map(pkg => <Meter fraction={…} />)`)
 * blev dømt i en funktion uden kald og slap fri. Nu læses kalde og afledte i
 * det yderste funktionsled, og hver `.map`-parameter bærer de kald, der føder
 * den samling den går over.
 *
 * 6.18 lukkede et hull i selve navnesproget: `\b` i JavaScript kender kun
 * ASCII, så en afledt `const` som `const rækker = …` blev aldrig fundet — den
 * samme fejlform som de tre huller ovenfor, bare i regexen. Målingen efter
 * rettelsen fandt **nul** steder, så det var porten, ikke koden.
 *
 * Kendte grænser, så næste iteration ikke læser porten som en løsning:
 * - En `.map`-callback skal være *første* argument i et kald på et medlem
 *   (`map`, `filter`, `flatMap`, `forEach`, `sort`). En callback der får en
 *   samling rakt ind som prop (`items.map(renderRow)`) dømmes i den komponent,
 *   der rækken kommer fra — samme grænse som for rakt-ned-værdier.
 * - Et destruktureret kald *uden* `isError` i sin binding kan ingen fejltilstand
 *   dække: porten ved ikke hvornår det fejler, så tallet dømmes.
 * - Kald der læses i en child-komponent dømmes i den child, ikke i forældren.
 */
describe('et tal må ikke vise sig for et kald der fejlede', () => {
  it('finder ingen i src/', () => {
    const root = join(__dirname, '..');
    const funder = sourceFiles(root).flatMap(file => scanSource(file.replace(root, 'src'), readFileSync(file, 'utf-8')));

    // Målingen 30/9 (6.15) fandt nul: de tolv `StatTile` fra 6.14, de ni
    // regioner fra R5 og de to `ListRow` på abonnementssiden har alle en
    // fejltilstand. `Badge`-tællere (`week-card`) ligger under samme
    // `ErrorState`, og ingen `Meter` læser et kald uden for sin egen
    // fejlgren. 6.16's måling af de fem destrukturerede kald fandt også nul.
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

  it('kan overhovedet se et tal uden fejltilstand', () => {
    // Porten skal kunne fejle. Uden denne test er "fund ingen" lige så sandt
    // for en port, der slet ikke læser noget.
    const kode = [
      'export function E() {',
      '  const flex = trpc.enterprise.getBalance.useQuery();',
      '  return <StatTile label="Flex" value={formatHours(flex.data?.balance ?? 0)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <StatTile> flex']);
  });

  it('følger værdien gennem en afledt const', () => {
    // Hullet fra 6.15: værdien er flyttet én linje op, så porten så ingen
    // `kald.data` i proppen og sagde ingenting.
    const kode = [
      'export function G() {',
      '  const entries = trpc.time.list.useQuery({});',
      '  const timer = (entries.data ?? []).reduce((sum, e) => sum + e.hours, 0);',
      '  return <StatTile label="Timer" value={formatHours(timer)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:4  <StatTile> entries']);
  });

  it('følger værdien gennem to led af afledte const', () => {
    const kode = [
      'export function H() {',
      '  const entries = trpc.time.list.useQuery({});',
      '  const timer = (entries.data ?? []).reduce((sum, e) => sum + e.hours, 0);',
      '  const iAlt = timer + 1;',
      '  return <StatTile label="I alt" value={formatHours(iAlt)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:5  <StatTile> entries']);
  });

  it('dømmer hvert kald for sig, ikke funktionen for alle', () => {
    // Det andet hulle fra 6.15: ét kald med `isError` + ét `ErrorState` slap
    // i 6.14 også *naboens* tal, fordi porten dømte funktionen og ikke kaldet.
    const kode = [
      'export function F() {',
      '  const flex = trpc.enterprise.getBalance.useQuery();',
      '  const profit = trpc.time.getProfitability.useQuery();',
      '  return (',
      '    <SectionState isError={flex.isError}>',
      '      <StatTile label="Timer" value={formatHours(profit.data?.totalHours ?? 0)} />',
      '      <StatTile label="Flex" value={formatHours(flex.data?.balance ?? 0)} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:6  <StatTile> profit']);
  });
});

/**
 * 6.16: porten genkendte kun `const flex = trpc.…` og så slet ikke den anden
 * form af `useQuery` — `const { data, isError } = trpc.…`, hvor værdien og
 * svaret er løftet ud af kallet. Målt i `src/`: 245 navngivne kald mod 5
 * destrukturerede, så hullet var lille, men helt: de fem var præcis dem, der
 * løfter værdien ud, så porten havde ingen navne at følge. Målingen fandt
 * **nul** steder — de fem maler hver deres egen `ErrorState` — så det var
 * porten, ikke koden, der blev rettet.
 */
describe('porten genkender begge former af useQuery', () => {
  it('ser et tal fra et destruktureret kald', () => {
    const kode = [
      'export function P() {',
      '  const { data, isLoading, isError, refetch } = trpc.time.getStats.useQuery();',
      '  return <StatTile label="I alt" value={formatHours(data?.totalHours ?? 0)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <StatTile> data (time.getStats)']);
  });

  it('ser et tal gennem en omdøbt binding', () => {
    const kode = [
      'export function Q() {',
      '  const { data: pakker, isError: fejl } = trpc.prepaid.list.useQuery({ activeOnly: true });',
      '  return <Meter fraction={pakker.length / 10} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <Meter> pakker (prepaid.list)']);
  });

  it('lader et destruktureret kald være, når ErrorState males af dets isError', () => {
    const kode = [
      'export function U() {',
      '  const { data, isLoading, isError, refetch } = trpc.time.weeklyGoalProgress.useQuery();',
      '  return isError',
      '    ? <ErrorState onRetry={refetch} />',
      '    : <Badge label={data.isOnTrack ? "På rette spor" : "Bagefter"} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader et tal være, når proppen selv læser isError', () => {
    const kode = [
      'export function V() {',
      '  const { data, isError } = trpc.team.list.useQuery();',
      '  return <Badge label={isError ? "Kunne ikke hentes" : data?.length + " kørende"} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('dækker ikke et destruktureret kald med et ErrorState for et andet kald', () => {
    // `isError` står også i deklarationen. Uden at fjerne den ville porten
    // give kaldet frit lejde, fordi funktionen *har* et `ErrorState` — bare
    // ikke til det.
    const kode = [
      'export function W() {',
      '  const flex = trpc.enterprise.getBalance.useQuery();',
      '  const { data, isError, refetch } = trpc.time.getStats.useQuery();',
      '  return (',
      '    <SectionState isError={flex.isError} onRetry={() => void refetch()}>',
      '      <StatTile label="I alt" value={formatHours(data?.totalHours ?? 0)} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:6  <StatTile> data (time.getStats)']);
  });

  it('dømmer et destruktureret kald, der ikke selv har et isError', () => {
    // Uden `isError` i bindingen ved porten ikke, hvornår kaldet fejler, så
    // ingen malet fejltilstand kan stå for det.
    const kode = [
      'export function X() {',
      '  const flex = trpc.enterprise.getBalance.useQuery();',
      '  const { data } = trpc.time.getStats.useQuery();',
      '  return (',
      '    <SectionState isError={flex.isError}>',
      '      <StatTile label="I alt" value={formatHours(data?.totalHours ?? 0)} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:6  <StatTile> data (time.getStats)']);
  });

  it('ser ikke et dansk ord i en tekst som et kald', () => {
    // "Kunne ikke hente data." er tekst, ikke et kald. Uden at blanke strenge
    // ud ville `data.` ramme og dømme en fejl, der ikke er der — og den så
    // ud som om den skulle rettes i koden.
    const kode = [
      'export function Y() {',
      '  const flex = trpc.enterprise.getBalance.useQuery();',
      '  const { data, isError } = trpc.time.getStats.useQuery();',
      '  return (',
      '    <SectionState isError={flex.isError}>',
      '      <Badge label="Kunne ikke hente data." />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });
});

/**
 * 6.17: porten læste kun `const` på funktionsniveau, så et element i en
 * `.map`-callback blev dømt i en indre funktion uden kald — og slap fri.
 * `prepaid-card` er det målte eksempel: `Meter` males med `pkg` fra et `.map`,
 * og intet så, at `pkg` kommer fra `prepaid.list`.
 */
describe('porten følger værdien ind i en listerække', () => {
  it('ser et tal i en .map-callback', () => {
    const kode = [
      'export function Z() {',
      '  const pakker = trpc.prepaid.list.useQuery({});',
      '  return pakker.data?.map(pkg => <Meter key={pkg.id} fraction={pkg.fraction} />);',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <Meter> pakker']);
  });

  it('ser et tal i en afledt const inde i callbacket', () => {
    const kode = [
      'export function AB() {',
      '  const { data, isError, refetch } = trpc.prepaid.list.useQuery({});',
      '  return data?.map((pkg) => {',
      '    const rest = pkg.remainingHours;',
      '    return <Meter key={pkg.id} fraction={rest / pkg.totalHours} />;',
      '  });',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:5  <Meter> data (prepaid.list)']);
  });

  it('ser et tal i en rækkes højre side inde i callbacket', () => {
    const kode = [
      'export function AC() {',
      '  const entries = trpc.time.list.useQuery({});',
      '  return (',
      '    <View>',
      '      {entries.data?.map(e => (',
      '        <ListRow key={e.id} title={e.project?.name ?? ""} right={formatMoney(e.amount)} />',
      '      ))}',
      '    </View>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:6  <ListRow> entries']);
  });

  it('lader en liste være, når et ErrorState dækker hele samlingen', () => {
    // Den measurede form: `prepaid-card` maler `ErrorState` for hele listen,
    // så der er præcis ét `isError` for hele rækken. Den skal blive stille.
    const kode = [
      'export function AD() {',
      '  const { data, isLoading, isError, refetch } = trpc.prepaid.list.useQuery({});',
      '  return isLoading',
      '    ? null',
      '    : isError',
      '      ? <ErrorState onRetry={refetch} />',
      '      : data?.map(pkg => <Meter key={pkg.id} fraction={pkg.fraction} />);',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en liste være, når den ikke kommer fra et kald', () => {
    // `rækker` er et lokalt array, ikke et `trpc`-kald — porten må ikke kræve
    // en fejltilstand for tal den ikke kan fejle.
    const kode = [
      'export function AE() {',
      '  const rækker = [1, 2, 3];',
      '  return rækker.map(tal => <Badge key={tal} label={String(tal)} />);',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en mutation og trpc.useUtils være', () => {
    // Den målte falske positive i `security-screen`: `trpc.useUtils()` så ud
    // som et kald, mutationen som en afledt `const` af det, og rækkens
    // `revokeOne.isPending` som et tal fra en fejlet hentning. Ingen af delene
    // er data der kan fejle at hente.
    const kode = [
      'export function AF() {',
      '  const utils = trpc.useUtils();',
      '  const onDone = async () => { await utils.security.invalidate(); };',
      '  const revokeOne = trpc.security.revokeSession.useMutation({ onSuccess: onDone });',
      '  const list = trpc.security.getSessions.useQuery().data ?? [];',
      '  return list.map(s => (',
      '    <ListRow key={s.id} title={s.id} right={revokeOne.isPending ? <Button label="Giver op" /> : <Badge label="OK" />} />',
      '  ));',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });
});

/**
 * De to huller 6.15 lukkede: værdien en linje oppe i en afledt `const`, og
 * ét kald der dækker et nabokalds tal. Plus de komponenter, der viser et tal
 * uden at være et `StatTile`.
 */
describe('porten ser hele fejlformen, ikke kun de kendte kort', () => {
  it('ser en bjælke, en chip og en rækkes højre side', () => {
    // 6.14 dømte kun `StatTile`. De tre andre kan vise det samme tal.
    const kode = [
      'export function I() {',
      '  const pkg = trpc.prepaid.list.useQuery({});',
      '  const live = trpc.team.list.useQuery();',
      '  const stats = trpc.time.getStats.useQuery();',
      '  return (',
      '    <>',
      '      <Meter fraction={pkg.data?.progress ?? 0} />',
      '      <Badge label={live.data?.length + " kørende"} />',
      '      <ListRow title="I alt" right={formatHours(stats.data?.totalHours ?? 0)} />',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([
      'syntetisk.tsx:7  <Meter> pkg',
      'syntetisk.tsx:8  <Badge> live',
      'syntetisk.tsx:9  <ListRow> stats',
    ]);
  });

  it('lader en rækkes titel være, når kun højre side er et tal', () => {
    // `ListRow`s titel kommer af en prop, der ikke er `right`; dommen skal
    // ikke gribe fat i den og kræve en fejltilstand for tekst.
    const kode = [
      'export function J({ navn }: { navn: string }) {',
      '  const stats = trpc.time.getStats.useQuery();',
      '  return <ListRow title={navn} subtitle={stats.data?.note} right={formatHours(stats.data?.totalHours ?? 0)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <ListRow> stats']);
  });

  it('lader et tal være, der siger fejlen, eller males af en fejltilstand', () => {
    const kode = [
      'export function K() {',
      '  const flex = trpc.enterprise.getBalance.useQuery();',
      '  const profit = trpc.time.getProfitability.useQuery();',
      '  return (',
      '    <SectionState isError={flex.isError}>',
      '      <StatTile label="Flex" value={formatHours(flex.data?.balance ?? 0)} />',
      '      <StatTile label="Timer" value={formatHours(profit.data?.totalHours ?? 0)} error={profit.isError} />',
      '      <Badge label={profit.isError ? "…" : "Godkendt"} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader et tal være, hvis kaldet ikke er et kald', () => {
    // `stats` her er et lokalt objekt, ikke et `trpc`-kald — porten skal ikke
    // kræve en fejltilstand for tal den ikke kan fejle.
    const kode = [
      'export function L({ stats }: { stats: Stats }) {',
      '  const timer = stats.totalHours;',
      '  return <StatTile label="Timer" value={formatHours(timer)} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });
});
