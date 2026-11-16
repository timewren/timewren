import type { Node } from './ast-scanner';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributter, erFunktion, forfælder, gaasMedStak, linje, navn, paa, parseKode, tekst } from './ast-scanner';

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
 * `æ` er ikke et `\w` i JavaScript, så `\brækker\b` aldrig rammer en dansk
 * binding. Derfor er `ORD` en ordgrænse med blik bagud i stedet.
 */
const ORD = (navn: string) => `(?<![\\w$])${navn}(?![\\w$])`;

/** Et navn i kode: ASCII eller dansk. Uden `æ/ø/å` så de afledte `const`. */
const NAVN = '[\\p{L}_$][\\p{L}\\p{N}_$]*';

const DESTRUKTURERET = /const\s*\{([^}]*)\}\s*=\s*trpc\.([^(\s]+)\.useQuery[^;]*;/gu;

/** Navnet en binding får i koden: `data`, `data: pakker` → `pakker`. */
function binding(bindinger: string, navn: string): string | undefined {
  for (const m of bindinger.matchAll(new RegExp(`(${NAVN})\\s*(?::\\s*(${NAVN}))?`, 'giu'))) {
    if (m[1] === navn)
      return m[2] ?? navn;
  }
  return undefined;
}

/**
 * Ét kald porten dømmer, uanset hvilken form `useQuery` blev skrevet i — samme
 * to former som `empty-state-error.test.ts` og `stat-tile-error.test.ts` læser.
 * Kun `useQuery` er et kald: `trpc.useUtils()` har ingen data at vise, og en
 * mutations `data` er resultatet af sidste kørsel.
 */
type Kald = {
  /** Hvad fundet skal navngive, så en læser kan finde kallet i koden. */
  rapport: string;
  /** Matcher en læsning af kaldets data. */
  vaerdi: RegExp;
  /** Matcher en afledt `const`, der flytter kaldets værdi videre. */
  vaerdiFlyttet: RegExp;
  /** Matcher kaldets egen `isError` — i props eller i en malet fejltilstand. */
  svar: RegExp;
  /** Matcher kaldets fejlflag i en betingelse, uden krav om et tegn bagefter. */
  flag: RegExp;
  /** Navnene en betingelse kan undersøge: kaldet selv og et direkte alias. */
  vaerdiNavne: string[];
};

function navngivetKald(kode: string): Kald[] {
  return Array.from(kode.matchAll(new RegExp(`const\\s+(${NAVN})\\s*=\\s*trpc\\.[^(\\s]+\\.useQuery\\s*\\(`, 'gu')), ([, navn]) => ({
    rapport: navn,
    vaerdi: new RegExp(`${ORD(navn)}\\s*\\??\\.data\\b`),
    vaerdiFlyttet: new RegExp(`${ORD(navn)}\\s*\\??\\.`),
    svar: new RegExp(`${ORD(navn)}\\s*\\??\\.isError\\b`),
    flag: new RegExp(`${ORD(navn)}\\s*\\??\\.\\s*isError\\b`),
    vaerdiNavne: [navn],
  }));
}

/**
 * `const { data, isError } = trpc.…` — værdien og svaret er løftet ud af kallet
 * og hedder begge `data`/`isError`, så porten læser dem i mønsteret. Blik bagud,
 * så værdien `flex.isError` ikke frikender et kald om noget helt andet.
 */
function destruktureretKald(kode: string): Kald[] {
  const fund: Kald[] = [];
  for (const [, bindinger, procedure] of kode.matchAll(DESTRUKTURERET)) {
    const vaerdi = binding(bindinger, 'data');
    if (!vaerdi)
      continue;
    const svar = binding(bindinger, 'isError');
    fund.push({
      rapport: `${vaerdi} (${procedure})`,
      vaerdi: new RegExp(`${ORD(vaerdi)}\\s*(\\?\\?|\\?\\.|\\.|\\[|\\()`),
      vaerdiFlyttet: new RegExp(ORD(vaerdi)),
      svar: svar ? new RegExp(`(?<!\\.)${ORD(svar)}\\s*(\\?\\?|\\?|\\.|&&|\\|\\||\\)|\\]|\\})`) : /\\bfindes_aldrig\\b/,
      flag: new RegExp(ORD(svar ?? vaerdi)),
      vaerdiNavne: [vaerdi],
    });
  }
  return fund;
}

/**
 * Kalde og afledte `const` i én funktion. `resten` er koden uden destrukturerede
 * deklarationer: et `isError`, der kun står i deklarationen, er et flagnavn.
 */
function kalde(kode: string): { kald: Kald[]; resten: string } {
  return {
    kald: [...navngivetKald(kode), ...destruktureretKald(kode)],
    resten: kode.replace(DESTRUKTURERET, ''),
  };
}

/**
 * Afledte `const`, transitivt: `const rækker = kald.data ?? []` giver ét
 * niveau, `const valgte = rækker.filter(…)` giver to. Det er *værdien* der
 * flytter sig, så porten skal følge med — ellers er `options={clientOptions}`
 * usynlig, selv om `clientOptions` stammer fra et kald.
 */
function afledte(kode: string, kald: Kald[]): Map<string, Set<Kald>> {
  const afledt = new Map<string, Set<Kald>>();
  for (let runde = 0; runde < 12; runde++) {
    let ændret = false;
    for (const m of kode.matchAll(new RegExp(`const\\s+(${NAVN})\\s*=\\s*([^;]+);`, 'gu'))) {
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

const KÆDER = ['&&', '||', '??'];

/**
 * Betingelser i ét led, som rå tekstuddrag af kilden.
 *
 * Babel deler TypeScripts `BinaryExpression` i to: `&&`, `||` og `??` er
 * `LogicalExpression` her, så porten læser begge former. Det er disse, der
 * afgør om kallet fejler, så det er også de eneste, der må dække et felt. At
 * læse hele funktionen i stedet var for svagt: `if (packages.isError)` i en
 * anden* funktion ville dække feltet her, og `if (options.length === 0)`
 * ville dække et kald det ikke har med at gøre.
 */
function betingelser(kode: string, node: Node): string[] {
  const fund: string[] = [];
  gaasMedStak(node, (n) => {
    if (n.type === 'IfStatement' || n.type === 'ConditionalExpression') {
      fund.push(tekst(kode, n));
    }
    else if ((n.type === 'BinaryExpression' || n.type === 'LogicalExpression') && KÆDER.includes(n.operator as string)) {
      fund.push(tekst(kode, paa(n, 'right')), tekst(kode, paa(n, 'left')));
    }
  });
  return fund;
}

/**
 * Dækker en betingelse kallet? Den skal undersøge kaldets fejlflag
 * (`clients.isError`) eller *værdiens fravær* (`!data`, `data === undefined`) —
 * den sidste er den samme fejl, for uden data er der kun to grunde: endnu ikke
 * hentet eller fejlet, og da er der noget at vise.
 *
 * `!options` hvor `options` er kaldets *afledte liste* dækker ikke: en
 * fejlet `clients.list` giver lige så vel en tom `options`, så det er præcis
 * den stilhed porten skal fange. Kun et navn der er et rent alias af værdien
 * (`const data = query.data`) tæller med.
 */
function daekker(betingelse: string, navne: string[], flag: RegExp): boolean {
  if (flag.test(betingelse))
    return true;
  return navne.some(navn => new RegExp(`(^|\\W)(!\\s*${ORD(navn)}\\b|${ORD(navn)}\\s*(===|==)\\s*(undefined|null)\\b)`).test(betingelse));
}

/** Navne der er et rent alias af kaldets værdi: `const data = query.data`. */
function aliaser(kode: string, kald: Kald[]): Map<string, Set<Kald>> {
  const aliaser = new Map<string, Set<Kald>>();
  for (const m of kode.matchAll(new RegExp(`const\\s+(${NAVN})\\s*=\\s*([^;]+);`, 'gu'))) {
    const [, navn, rhs] = m;
    for (const k of kald) {
      const ren = rhs.trim().replace(/^[(!]+|[)!]+$/g, '').replace(/^\\((\\s*)[()]|\\)$/g, '').trim();
      if (k.vaerdi.test(ren) && !/[[({]/.test(ren))
        aliaser.set(navn, new Set([...(aliaser.get(navn) ?? []), k]));
    }
  }
  return aliaser;
}

/** Hvilke kald der føder en prop — gennem kaldet selv eller en afledt `const`. */
function naaer(prop: string, kald: Kald[], afledt: Map<string, Set<Kald>>): Set<Kald> {
  const naaer = new Set<Kald>();
  for (const k of kald) {
    if (k.vaerdi.test(prop))
      naaer.add(k);
  }
  for (const [navn, kilder] of afledt) {
    if (new RegExp(`[({=,?\\s]${ORD(navn)}`).test(prop))
      kilder.forEach(k => naaer.add(k));
  }
  return naaer;
}

/**
 * Props der *fylder* noget: en liste, en vælger, et søgefelt. Navnene er fra
 * koden, ikke en liste over komponenter — en komponent med et nyt navn skal
 * dømmes uden at porten læres op, og det er præcis den fejl de tre forrige
 * porter havde (6.14 dømte kun `StatTile`, 6.15 bad om de fire kendte kort).
 */
const FYLDER = new Set(['options', 'items', 'data', 'values', 'entries', 'rows']);

/** Tekst i `'` og `"` er indhold, ikke kode. */
function udenStrenge(tekst: string): string {
  return tekst.replace(/'[^']*'|"[^"]*"/g, '""');
}

/** Værdien af hver prop, der fylder noget, som én tekst. */
function fyldendeProps(kode: string, node: Node): string {
  return attributter(node, n => FYLDER.has(n))
    .map(p => udenStrenge(tekst(kode, paa(p, 'value'))))
    .join(' ');
}

/**
 * Navnene på de props, der ikke fylder — dem skal svare på et kaldets
 * `isError`. En prop uden værdi (`isError`) tæller som *sand*, fordi den er
 * skrevet uden værdi lige netop fordi læseren ikke skal se noget.
 */
function svarProps(kode: string, node: Node): string {
  return udenStrenge(attributter(node, n => !FYLDER.has(n))
    .map(p => paa(p, 'value') ? tekst(kode, paa(p, 'value')) : 'sant')
    .join(' '));
}

function scanSource(file: string, source: string): string[] {
  const ast = parseKode(source);
  const fund: string[] = [];

  // Porten dømmer den *åbne* JSX-side — `<Select … />` og `<Select …>…</Select>` —
  // og går ikke videre ind i den. Det er ikke en vilje: elementet er ét sæt
  // props, så en `<View options={…}>` der omslutter en `<Select options={…}>`
  // ville blive dømt to gange for den samme aflevering. Bemærk at kun den
  // åbne side standser: en `<View>…</View>` med børn er en *beholder*, som
  // børnene dømmes i — ellers ville porten ikke kunne se et felt i en liste.
  gaasMedStak(paa(ast, 'program') ?? ast, (node, stak) => {
    if (node.type !== 'JSXSelfClosingElement' && node.type !== 'JSXOpeningElement')
      return;
    const props = fyldendeProps(source, node);
    if (!props)
      return false;
    // Kalde, afledte og betingelser læses i det yderste funktionsled: en
    // `.map`-række maler elementer i en indre funktion, men både værdien og
    // fejlgrenen kommer udenfra. Uden en funktionforfældre er hele filen
    // leddet — samme fallback som `findAncestor(isSourceFile)` før.
    const egen = forfælder(stak, erFunktion);
    const kode = egen ? tekst(source, egen) : source;
    const kald = kalde(kode);
    const naaerKald = naaer(props, kald.kald, afledte(kode, kald.kald));
    // Ét kald må *kun* dækkes af en betingelse der læser netop dets flag
    // eller dets værdis fravær, så et hængende nabo-kald ikke dækker sit eget
    // felt — det er den fejl R5 og 6.17 begge levede af.
    const alias = aliaser(kode, kald.kald);
    const forhold = betingelser(source, egen ?? node);
    const uvedhovedede = [...naaerKald].filter(k => !k.svar.test(svarProps(source, node))
      && !forhold.some(b => daekker(b, [...k.vaerdiNavne, ...[...alias].filter(([, m]) => m.has(k)).map(([aliasNavn]) => aliasNavn)], k.flag)));
    if (uvedhovedede.length > 0)
      fund.push(`${file}:${linje(node)}  <${navn(paa(node, 'name')) ?? ''}> ${uvedhovedede.map(k => k.rapport).join(', ')}`);
    return false;
  });
  return fund;
}

/**
 * Et kald der fejler, og så bliver rakt videre som en liste til et felt på en
 * anden skærm (`options={kald.data}`) — opgave 6.19.
 *
 * 6.18 dømte kun `EmptyState` og `return null`, altså de steder hvor *den selv
 * maler* tomheden. Her er værdien rakt videre, så den fejlende kald er usynlig
 * for feltet: brugeren tapper på vælgeren og får "Ingen resultater", som om
 * listen bare var tom. På tidsformularen betyder det, at en kunde ikke kan
 * vælges — brugeren gemmer tiden på intern tid uden at forstå hvorfor.
 *
 * Kendte grænser, så næste iteration ikke læser porten som en løsning:
 * - Porten dømmer *afleveringen*, ikke feltet. Barnet kan ikke kende op i dets
 *   `options`-prop, så ansvaret ligger hos skærmen der rækker værdien ned.
 * - Værdier der ikke kommer fra et kald (lokale konstanter, `useMemo` over
 *   statisk data) er fri — de kan ikke fejle at hente.
 * - Ét kald må *kun* dækkes af en fejltilstand der læser netop dets `isError`.
 *   Et `ErrorState` for et nabo-kald dækker ikke, fordi det er et andet kald
 *   der kan fejle.
 */
describe('et felt må ikke se en tom liste, når kallet fejlede', () => {
  it('finder ingen i src/', () => {
    const root = join(__dirname, '..');
    const funder = sourceFiles(root).flatMap(file => scanSource(file.replace(root, 'src'), readFileSync(file, 'utf-8')));
    expect(funder).toEqual([]);
  });

  it('kan overhovedet se en rakt-ned-værdi uden fejlgren', () => {
    const kode = [
      'export function A() {',
      '  const clients = trpc.clients.list.useQuery({});',
      '  const clientOptions = (clients.data ?? []).map(c => ({ value: c.id, label: c.name }));',
      '  return <PickerField label="Kunde" value={null} options={clientOptions} onChange={() => {}} placeholder="Vælg" />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:4  <PickerField> clients']);
  });

  it('ser kaldets data rakt direkte ned', () => {
    const kode = [
      'export function B() {',
      '  const projects = trpc.projects.list.useQuery();',
      '  return <Select label="Projekt" options={projects.data ?? []} onSelect={() => {}} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <Select> projects']);
  });

  it('ser et destruktureret kald, hvis værdi er omdøbt', () => {
    const kode = [
      'export function C() {',
      '  const { data: pakker, isError } = trpc.prepaid.list.useQuery({});',
      '  return <PickerField options={pakker} onChange={() => {}} isError={isError} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('ser et kald i en afledt const, der går gennem to led', () => {
    const kode = [
      'export function D() {',
      '  const clients = trpc.clients.list.useQuery({});',
      '  const synlige = (clients.data ?? []).filter(c => !c.isArchived);',
      '  const valgte = synlige.map(c => ({ value: c.id, label: c.name }));',
      '  return <Select options={valgte} onSelect={() => {}} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:5  <Select> clients']);
  });

  it('lader et felt være, når forældren maler kaldets fejl', () => {
    const kode = [
      'export function E() {',
      '  const clients = trpc.clients.list.useQuery({});',
      '  const clientOptions = (clients.data ?? []).map(c => ({ value: c.id, label: c.name }));',
      '  return clients.isError',
      '    ? <ErrorState onRetry={() => void clients.refetch()} />',
      '    : <PickerField options={clientOptions} onChange={() => {}} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('dømmer hvert kald for sig, ikke funktionen for alle', () => {
    const kode = [
      'export function F() {',
      '  const clients = trpc.clients.list.useQuery({});',
      '  const projects = trpc.projects.list.useQuery();',
      '  return (',
      '    <>',
      '      <ErrorState onRetry={() => void clients.refetch()} />',
      '      <Select options={projects.data ?? []} onSelect={() => {}} />',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:7  <Select> projects']);
  });

  it('lader en liste være, der ikke kommer fra et kald', () => {
    const kode = [
      'export function G() {',
      '  const PROJECT_STATUSES = ["aktiv"];',
      '  const options = PROJECT_STATUSES.map(s => ({ value: s, label: s }));',
      '  return <Select options={options} onSelect={() => {}} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('ser ikke et dansk ord i en tekst som et kald', () => {
    const kode = [
      'export function H() {',
      '  const clients = trpc.clients.list.useQuery({});',
      '  return <Select options={[]} placeholder="Kunne ikke hente data." onSelect={() => {}} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });
});

/**
 * Dækningen af porten ovenfor. Den dømmer *kun*, at der ikke er fund, så uden
 * denne påstand er kæden `sourceFiles(root) === [] ⇒ fund === [] ⇒ grøn`: en
 * glob der rammer ingenting — testen flyttet et niveau ned, en rod der peger
 * forkert — bliver grøn, og gaten siger så til hver reviewer at appen
 * overholder reglen. Derfor dømmes dækningen for sig selv: et antal kilder, et
 * antal skærme (de filer porten er skrevet *for*) og en kendt fil fra
 * UI-kittet, så en forkert rod er rød frem for grøn.
 */
describe('portens dækning af src/', () => {
  it('finder kilder at kontrollere', () => {
    const root = join(__dirname, '..');
    const kilder = sourceFiles(root);
    expect(kilder.length).toBeGreaterThan(200);
    expect(kilder.filter(f => f.endsWith('-screen.tsx')).length).toBeGreaterThan(40);
    expect(kilder.some(f => f.endsWith(join('components', 'ui', 'button.tsx')))).toBe(true);
  });
});
