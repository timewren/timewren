import type { Node } from './ast-scanner';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributter, erFunktion, gaasMedStak, linje, navn, paa, parseKode, tekst } from './ast-scanner';

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
 * Ét kald porten dømmer, uanset hvilken form `useQuery` blev skrevet i — samme
 * to former som tal-porten (`stat-tile-error.test.ts`) læser.
 */
type Kald = {
  /** Hvad fundet skal navngive, så en læser kan finde kallet i koden. */
  rapport: string;
  /** Kaldets egen navn i koden. */
  navn: string;
  /** Matcher en læsning af kaldets data. */
  vaerdi: RegExp;
  /** Matcher navnet alene — i `entries.map(…)` er navnet netop læst. */
  navnAlene: RegExp;
  /** Matcher en afledt `const`, der flytter kaldets værdi videre. */
  vaerdiFlyttet: RegExp;
  /** Matcher kaldets egen `isError` — i props eller i en malet fejltilstand. */
  svar: RegExp;
};

/**
 * Navne på dansk (`rækker`, `hjem`) er helt almindelige her, og JavaScripts
 * `\\b` kender kun ASCII — så `\\brækker\\b` ville aldrig ramme. Derfor er
 * `ORD` en ordgrænse, der bruger `(?<![\\w$])` i stedet: `æ` er ikke et
 * `\\w`, så grænsen holder, og `entries` matcher stadig ikke `entries2`.
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
 * `const flex = trpc.…useQuery()` — navnet bærer både værdien og svaret.
 *
 * Kun `useQuery` er et kald: `trpc.useUtils()` har ingen data at vise, og en
 * mutations `data` er resultatet af sidste kørsel.
 */
function navngivetKald(kode: string): Kald[] {
  return Array.from(kode.matchAll(new RegExp(`const\\s+(${NAVN})\\s*=\\s*trpc\\.[^(\\s]+\\.useQuery\\s*\\(`, 'gu')), ([, navn]) => ({
    rapport: navn,
    navn,
    vaerdi: new RegExp(`${ORD(navn)}\\s*\\??\\.data\\b`),
    navnAlene: new RegExp(ORD(navn)),
    vaerdiFlyttet: new RegExp(`${ORD(navn)}\\s*\\??\\.`),
    svar: new RegExp(`${ORD(navn)}\\s*\\??\\.isError\\b`),
  }));
}

/**
 * `const { data, isError, refetch } = trpc.…` — værdien og svaret er løftet
 * ud af kallet og hedder begge `data`/`isError`, så porten læser dem i
 * mønsteret. Et destruktureret kald uden `isError` i sin binding kan ingen
 * fejltilstand dække: porten ved ikke hvornår det fejler, så det dømmes.
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
      navn: vaerdi,
      vaerdi: new RegExp(`${ORD(vaerdi)}\\s*(\\?\\?|\\?\\.|\\.|\\[|\\()`),
      navnAlene: new RegExp(ORD(vaerdi)),
      vaerdiFlyttet: new RegExp(ORD(vaerdi)),
      // Blik bagud, så værdien `flex.isError` ikke frikender et andet kald.
      svar: svar ? new RegExp(`(?<!\\.)${ORD(svar)}\\s*(\\?\\?|\\?|\\.|&&|\\|\\||\\)|\\]|\\})`) : /\bfindes_aldrig\b/,
    });
  }
  return fund;
}

/**
 * Kalde og afledte `const` i én funktion. `resten` er koden uden
 * destrukturerede deklarationer: et `isError`, der kun står i deklarationen,
 * er et flagnavn og ikke en fejltilstand.
 */
function kalde(kode: string): { kald: Kald[]; resten: string } {
  return {
    kald: [...navngivetKald(kode), ...destruktureretKald(kode)],
    resten: kode.replace(DESTRUKTURERET, ''),
  };
}

/**
 * Afledte `const` i samme funktion, transitivt: `const rækker = kald.data ?? []`
 * giver ét niveau, `const iAlt = rækker + 1` giver to. Det er værdien der
 * flytter sig, så porten skal følge med.
 */
function afledte(kode: string, kald: Kald[], frø?: Map<string, Set<Kald>>): Map<string, Set<Kald>> {
  const afledt = new Map(frø ?? []);
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

/** Hvilke kald der læses i de givne tekster — betingelser om "er den tom". */
function naaer(tekster: string[], kald: Kald[], afledt: Map<string, Set<Kald>>): Set<Kald> {
  const naaer = new Set<Kald>();
  for (const k of kald) {
    if (tekster.some(t => k.vaerdi.test(t) || k.navnAlene.test(t)))
      naaer.add(k);
  }
  for (const [navn, kilder] of afledt) {
    if (tekster.some(t => new RegExp(ORD(navn)).test(t)))
      kilder.forEach(k => naaer.add(k));
  }
  return naaer;
}

const KÆDER = ['&&', '||', '??'];
const SammenLIGN = ['===', '!==', '<', '>', '<=', '>='];

/**
 * De *prøvninger* i en betingelse — sammenligninger og negeringer.
 *
 * En betingelse som `profil.data?.name && kunder.data?.length === 0` har to
 * dele, men kun den sidste afgør, om listen er tom. Uden denne skelnelse ville
 * porten dømme begge kalde, fordi de står i samme udtryk.
 */
/** Noder `proevninger` vil gå ned i — de øvrige er beregningsstøj, ikke prøvninger. */
const NED_I = new Set(['BinaryExpression', 'LogicalExpression', 'ConditionalExpression', 'MemberExpression', 'CallExpression']);

/**
 * De *prøvninger* i en betingelse — sammenligninger og negeringer.
 *
 * En betingelse som `profil.data?.name && kunder.data?.length === 0` har to
 * dele, men kun den sidste afgør, om listen er tom. Uden denne skelnelse ville
 * porten dømme begge kalde, fordi de står i samme udtryk.
 *
 * Babel kalder `!x` en `UnaryExpression` og kæderne (`&&`, `||`, `??`) en
 * `LogicalExpression`, mens TypeScript kaldte den første
 * `PrefixUnaryExpression` og den anden del af `BinaryExpression`. Parenteser
 * er derimod *ikke* en node her — de er væk i parseren — så den gamle
 * `ParenthesizedExpression`-gren er udgået, og `MemberExpression` dækker både
 * punktum- og hakketilgang, hvor TypeScript havde to funktioner.
 */
function proevninger(kode: string, node: Node): string[] {
  const fund: string[] = [];
  gaasMedStak(node, (n) => {
    if (n.type === 'BinaryExpression' && SammenLIGN.includes(n.operator as string)) {
      fund.push(tekst(kode, n));
      return false;
    }
    if (n.type === 'UnaryExpression' && n.operator === '!') {
      fund.push(tekst(kode, n));
      return false;
    }
    if (n.type === 'CallExpression') {
      fund.push(tekst(kode, n));
      return false;
    }
    // Ellers kun ned i de noder, der *er* prøvninger. En fundet prøvning
    // standser, for dens indre er læst med hele teksten.
    return NED_I.has(n.type);
  });
  return fund;
}

/**
 * De betingelser der afgør, om skærmen viser `EmptyState` — og `data`-proppen
 * for en `ListEmptyComponent`, hvor listerækken selv afgør det.
 *
 * Det er disse betingelser, ikke hele funktionen, der afgør hvilket kald
 * porten dømmer: `query.isError ? <ErrorState/> : <EmptyState/>` skal dømme
 * `query`, mens et naborald i samme skærm skal være fri.
 *
 * `stak` er hele kæden fra roden til den tomme tilstand, så `nuv` og `forælder`
 * er de samme to noder som før — kun uden `parent`-peg, fordi parseren ikke
 * bygger dem.
 */
function betingelser(kode: string, stak: Node[]): string[] {
  const fund: string[] = [];
  const node = stak[stak.length - 1];
  let nuv = node;
  for (let i = stak.length - 2; i >= 0; i--) {
    const forælder = stak[i];
    if (forælder.type === 'ConditionalExpression') {
      fund.push(...proevninger(kode, paa(forælder, 'test') as Node));
      nuv = forælder;
    }
    else if ((forælder.type === 'BinaryExpression' || forælder.type === 'LogicalExpression') && KÆDER.includes(forælder.operator as string)) {
      const venstre = paa(forælder, 'left');
      fund.push(...proevninger(kode, (venstre === nuv ? paa(forælder, 'right') : venstre) as Node));
      nuv = forælder;
    }
    else if (forælder.type === 'IfStatement' && (paa(forælder, 'consequent') === nuv || paa(forælder, 'alternate') === nuv)) {
      fund.push(...proevninger(kode, paa(forælder, 'test') as Node));
      nuv = forælder;
    }
    else if (['JSXExpressionContainer', 'BlockStatement', 'ReturnStatement'].includes(forælder.type)) {
      nuv = forælder;
    }
    else if (forælder.type === 'JSXAttribute' && navn(paa(forælder, 'name')) === 'ListEmptyComponent') {
      fund.push(listeData(kode, stak[i - 1]));
      break;
    }
    else {
      break;
    }
  }
  return fund;
}

/** Værdien af `data` på det element, `ListEmptyComponent` sidder på. */
function listeData(kode: string, element: Node | undefined): string {
  const [prop] = attributter(element, n => n === 'data');
  const vaerdi = paa(prop, 'value');
  // En tekstlig `data` (`data="Ingen tider"`) er indhold, ikke et kald.
  return vaerdi && vaerdi.type !== 'StringLiteral' ? tekst(kode, vaerdi) : '';
}

function erEmptyState(node: Node): boolean {
  if (node.type === 'JSXSelfClosingElement' || node.type === 'JSXElement')
    return navn(paa(node, 'name') ?? paa(node, 'openingElement', 'name')) === 'EmptyState';
  return false;
}

function erReturnNull(node: Node): boolean {
  return node.type === 'ReturnStatement' && paa(node, 'argument')?.type === 'NullLiteral';
}

/** Alt porten skal ved om den aktuelle fil — koden, stien og fundene. */
type Kontekst = { kode: string; fil: string; fund: string[] };

/**
 * De funktioner `node` ligger inde i, yderste først — så `kæde` (rod først)
 * vendes. Det er det yderste led, porten læser kalde og afledte fra: en
 * `.map`-række maler elementer i en indre funktion, men kaldene og
 * fejlgrenen kommer udenfra.
 */
function ydersteLed(stak: Node[]): Node | undefined {
  return stak.find(erFunktion);
}

function dom(node: Node, stak: Node[], ctx: Kontekst): boolean | void {
  const { kode } = ctx;
  const erTom = erEmptyState(node) || erReturnNull(node);
  const egen = ydersteLed(stak);

  if (erTom && egen) {
    const koder = tekst(kode, egen);
    const { kald, resten } = kalde(koder);
    const naaerKald = naaer(betingelser(kode, stak), kald, afledte(koder, kald));
    const uvedhovedede = [...naaerKald].filter(k => !k.svar.test(resten));
    if (uvedhovedede.length > 0) {
      const tag = erEmptyState(node) ? '<EmptyState>' : 'return null';
      ctx.fund.push(`${ctx.fil}:${linje(node)}  ${tag} ${uvedhovedede.map(k => k.rapport).join(', ')}`);
    }
    return false;
  }
}

function scanSource(file: string, source: string): string[] {
  const ast = parseKode(source);
  const ctx: Kontekst = { kode: source, fil: file, fund: [] };
  gaasMedStak(paa(ast, 'program') ?? ast, (node, stak) => dom(node, stak, ctx));
  return ctx.fund;
}

describe('en tom liste må ikke skjule at et kald fejlede', () => {
  it('finder ingen i src/', () => {
    const root = join(__dirname, '..');
    const funder = sourceFiles(root).flatMap(file => scanSource(file.replace(root, 'src'), readFileSync(file, 'utf-8')));
    expect(funder).toEqual([]);
  });

  it('kan overhovedet se en tom liste uden fejltilstand', () => {
    const kode = [
      'export function A() {',
      '  const entries = trpc.time.list.useQuery({});',
      '  if (!entries.data || entries.data.length === 0)',
      '    return <EmptyState title="Ingen tider" />;',
      '  return entries.data.map(e => e.id);',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:4  <EmptyState> entries']);
  });

  it('ser en ternær, hvor tomheden er betingelsen', () => {
    const kode = [
      'export function B() {',
      '  const { data, isLoading } = trpc.time.list.useQuery({});',
      '  return isLoading ? null : data?.length === 0 ? <EmptyState title="Ingen" /> : data;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <EmptyState> data (time.list)']);
  });

  it('ser en afledt liste der afgør tomheden', () => {
    const kode = [
      'export function C() {',
      '  const live = trpc.team.liveTimers.useQuery();',
      '  const rækker = (live.data ?? []).filter(t => t.isRunning);',
      '  return rækker.length === 0 ? <EmptyState title="Ingen" /> : rækker.length;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:4  <EmptyState> live']);
  });

  it('ser en EmptyState som ListEmptyComponent', () => {
    const kode = [
      'export function D() {',
      '  const pakker = trpc.prepaid.list.useQuery({});',
      '  return (',
      '    <List data={pakker.data} ListEmptyComponent={<EmptyState title="Ingen pakker" />} />',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:4  <EmptyState> pakker']);
  });

  it('ser en return null der skjuler en fejlet kald', () => {
    const kode = [
      'export function E() {',
      '  const members = trpc.team.list.useQuery();',
      '  if (!members.data)',
      '    return null;',
      '  return members.data.length;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:4  return null members']);
  });

  it('lader en tom tilstand være, når kaldets isError males', () => {
    const kode = [
      'export function F() {',
      '  const entries = trpc.time.list.useQuery({});',
      '  if (entries.isError)',
      '    return <ErrorState onRetry={() => void entries.refetch()} />;',
      '  return !entries.data || entries.data.length === 0 ? <EmptyState title="Ingen tider" /> : entries.data;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('dømmer kun det kald der afgør tomheden', () => {
    const kode = [
      'export function G() {',
      '  const profil = trpc.user.getProfile.useQuery();',
      '  const kunder = trpc.clients.list.useQuery();',
      '  return profil.data?.name && kunder.data?.length === 0 ? <EmptyState title="Ingen kunder" /> : null;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:4  <EmptyState> kunder']);
  });

  it('lader en liste være, der ikke kommer fra et kald', () => {
    const kode = [
      'export function H({ rækker }: { rækker: string[] }) {',
      '  return rækker.length === 0 ? <EmptyState title="Ingen" /> : rækker.length;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en fejlklasse være, der males i stedet for listen', () => {
    // `ErrorState` selv maler `EmptyState` med "Prøv igen" — det er den
    // fejltilstand, porten vil se, ikke en skjult fejl.
    const kode = [
      'export function I() {',
      '  const entries = trpc.time.list.useQuery({});',
      '  return <ErrorState message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />;',
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
