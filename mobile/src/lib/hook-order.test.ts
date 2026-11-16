import type { Node } from './ast-scanner';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boern, erFunktion, erKald, forfælder, gaasMedStak, linje, navn, paa, parseKode, vaerk } from './ast-scanner';

/**
 * Port mod krokorden — `Rendered fewer hooks than expected`, den ene
 * Sentry-fejl i `timetrack-app` der *ikke* er en netværksfejl
 * (TIMETRACK-APP-3, 25/9).
 *
 * React tæller krogene i hvert render. En krog, der kun nås i nogle renders,
 * gør den næste render til en fejl — og fejlen kommer som en kaste fra
 * ReactFiber, uden en stak der peger på den linje i vores kode, der har ændret
 * sig. Det er derfor den dyreste af de tre fejl i Sentry: de to andre er
 * forventede netværksfejl, denne dræber en skærm.
 *
 * Målingen før porten fandt **0** overtrædelser i `src/`: ingen komponent
 * returnerer før sin sidste krog, ingen krog ligger under en betingelse, ingen
 * krog ligger i en tilbagekaldelse. Det er altså ikke en rettelse af en kendt
 * fejl — det er en port, der gør klassen umulig at indføre i stedet for at
 * finde den igen i en udgivelse. Sentry-fejlen er fra 25/9, og de tre statiske
 * former er netop dem React selv kan ramme; ingen af dem kan ses i koden i dag.
 *
 * Kendte grænser, så næste iteration ikke læser porten som en løsning:
 * - En krog i et `try`/`catch` dømmes, selv om den er efter `catch` — React
 *   kører ikke krogen igen, hvis den første kast.
 * - En komponent, der er et kalds *argument* (`const Foo = () => …` er dømt,
 *   `memo(() => …)` er ikke), fordi porten kun kender navn og krop.
 * - Fast Refresh kan give samme fejl i en udviklingsbuild uden at koden
 *   overtræder reglen. Derfor skal fundet læses sammen med det, Sentry siger.
 */

/** Kilder under `src/` — `.ts` og `.tsx`, fordi de fleste egne kroge ligger i `.ts`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Navnet på et kald, hvis det er en krog: `useState`, `React.useMemo` og
 * `trpc.time.list.useQuery` er alle kroge, `getUser` er ikke. Bindestregen er
 * ikke tilladt før `use`, så `use-foo` ikke tæller med.
 */
function krogNavn(kald: Node): string | undefined {
  const callee = paa(kald, 'callee');
  if (!callee)
    return undefined;
  if (callee.type === 'Identifier')
    return /^use[A-Z0-9]/.test(navn(callee) ?? '') ? navn(callee) : undefined;
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression')
    return undefined;
  const ejendom = paa(callee, 'property');
  return ejendom && /^use[A-Z]/.test(navn(ejendom) ?? '') ? navn(ejendom) : undefined;
}

/** Betingelser, der ikke alle gennemføres — en krog under en af dem springer renders. */
const BETINGELSE = new Set([
  'IfStatement',
  'SwitchCase',
  'ConditionalExpression',
  'LogicalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'TryStatement',
]);

/** Funktioner uden navn — en krog i sådanne er i en tilbagekaldelse, ikke i en komponent. */
const ANONYM = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/** Navnet på den funktion, `stak` står i. */
function funktionsNavn(stak: Node[]): string {
  for (let i = stak.length - 1; i >= 0; i--) {
    const node = stak[i];
    if (node.type === 'FunctionDeclaration') {
      const eget = navn(paa(node, 'id'));
      if (eget)
        return eget;
    }
    if (node.type === 'VariableDeclarator' || node.type === 'ObjectProperty' || node.type === 'ClassMethod' || node.type === 'ObjectMethod') {
      const nøgle = paa(node, node.type === 'ClassMethod' || node.type === 'ObjectMethod' ? 'key' : 'id');
      const eget = navn(nøgle);
      if (eget)
        return eget;
    }
  }
  return 'en anonym funktion';
}

/**
 * En krog der ligger i en tilbagekaldelse: den nærmeste funktion er anonym, og
 * den er *argument* i et kald — altså `useEffect(() => { useX() })`. Hooksene i
 * tilbagekaldelsen hører til React, ikke til komponenten, så de tælles hver
 * gang kalderen kører.
 */
function iTilbagekaldelse(stak: Node[]): boolean {
  const funktion = forfælder(stak, erFunktion);
  if (!funktion || !ANONYM.has(funktion.type))
    return false;
  // Stien er rod først, så kalderen står lige *før* funktionen. Ikke via
  // `forfælder(…, erKald)`: den hopper bevidst det sidste led over, fordi den
  // skal finde en forfælder til det node, der lige er undersøgt.
  const kalder = stak[stak.indexOf(funktion) - 1];
  return Boolean(kalder && erKald(kalder) && (vaerk<Node[]>(kalder, 'arguments') ?? []).includes(funktion));
}

/** Den betingelse, der ligger mellem krogen og dens egen funktion. */
function betingelseOver(stak: Node[]): Node | undefined {
  for (let i = stak.length - 1; i >= 0; i--) {
    if (erFunktion(stak[i]))
      return undefined;
    if (BETINGELSE.has(stak[i].type))
      return stak[i];
  }
  return undefined;
}

/** Noderne i `rod` der tilhører samme funktion som `rod` — altså uden at gå ind i indre funktioner. */
function egne(rod: Node): Node[] {
  const egneNoder: Node[] = [];
  const ned = (node: Node): void => {
    if (node !== rod && erFunktion(node))
      return;
    egneNoder.push(node);
    for (const barn of boern(node))
      ned(barn);
  };
  ned(rod);
  return egneNoder;
}

type Fund = string;

/** Ét fund med sin egen sti i kilden, så de to former kan læses hver for sig. */
type Krog = { node: Node; stak: Node[]; navn: string };

/** Alle kloge i én fil, med stien til hver — de to øvrige former bruger den. */
function alleKroge(kode: string): Krog[] {
  const kroge: Krog[] = [];
  gaasMedStak(paa(parseKode(kode), 'program') as Node, (node, stak) => {
    const navn = erKald(node) ? krogNavn(node) : undefined;
    // `gaasMedStak` genbruger én stak og tømmer den igen, når kaldet er
    // tilbage — så stien skal kopieres, ellers står hver krog med en tom.
    if (navn)
      kroge.push({ node, stak: [...stak], navn });
  });
  return kroge;
}

/** Én fil, alle tre former. Fundene sorteres, så en diff viser dem i læserækkefølge. */
function scanSource(fil: string, kode: string): Fund[] {
  const fund: Fund[] = [];
  for (const { node, stak, navn } of alleKroge(kode)) {
    const hvilken = funktionsNavn(stak);
    if (iTilbagekaldelse(stak)) {
      fund.push(`${fil}:${linje(node)}  ${hvilken}: ${navn}() ligger i en tilbagekaldelse, ikke i komponentens krop`);
    }
    else {
      const betingelse = betingelseOver(stak);
      if (betingelse)
        fund.push(`${fil}:${linje(node)}  ${hvilken}: ${navn}() ligger under en ${betingelse.type}`);
    }
  }
  fund.push(...efterReturn(fil, alleKroge(kode)));
  return fund.sort();
}

/** De egne `return` i én funktion — ikke dem i en indre funktion, de hører til den. */
function egneReturns(funktion: Node): Node[] {
  return egne(funktion).filter(node => node.type === 'ReturnStatement');
}

/** Kloge der ligger efter en `return` i deres egen funktion. */
function efterReturn(fil: string, kroge: Krog[]): Fund[] {
  const prFunktion = new Map<Node, Krog[]>();
  for (const krog of kroge) {
    const funktion = forfælder(krog.stak, erFunktion);
    if (!funktion)
      continue;
    prFunktion.set(funktion, [...(prFunktion.get(funktion) ?? []), krog]);
  }
  const fund: Fund[] = [];
  for (const [funktion, egneKroge] of prFunktion) {
    for (const retur of egneReturns(funktion)) {
      for (const krog of egneKroge) {
        // `start > end` og ikke `> start`: en krog *inde i* den returnerede
        // værdi (`return { x: useMemo(…) }`) nås hver gang, så den er ikke
        // en krok efter return — den er krogen i returnen.
        if (krog.node.start > retur.end) {
          fund.push(`${fil}:${linje(krog.node)}  ${funktionsNavn([funktion])}: ${krog.navn}() står efter en return på linje ${linje(retur)}`);
        }
      }
    }
  }
  return fund;
}

describe('krogerne skal komme i samme rækkefølge hver gang', () => {
  it('finder ingen overtrædelser i src/', () => {
    const root = join(__dirname, '..');
    const funder = sourceFiles(root).flatMap(file => scanSource(file.replace(root, 'src'), readFileSync(file, 'utf-8')));

    expect(funder).toEqual([]);
  });

  it('finder kilder at kontrollere', () => {
    const root = join(__dirname, '..');
    const kilder = sourceFiles(root);
    expect(kilder.length).toBeGreaterThan(250);
    expect(kilder.filter(f => f.endsWith('-screen.tsx')).length).toBeGreaterThan(40);
    expect(kilder.some(f => f.endsWith('use-today.ts'))).toBe(true);
  });

  it('ser en krog der kommer efter en return', () => {
    const kode = [
      'export function Skærm({ åben }: { åben: boolean }) {',
      '  const [antal, sæt] = useState(0);',
      '  if (!åben)',
      '    return null;',
      '  const samlet = useMemo(() => antal * 2, [antal]);',
      '  return <Text>{samlet}{sæt.name}</Text>;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([
      'syntetisk.tsx:5  Skærm: useMemo() står efter en return på linje 4',
    ]);
  });

  it('ser en krog under en betingelse', () => {
    const kode = [
      'export function Kort({ vis }: { vis: boolean }) {',
      '  if (vis) {',
      '    const [fejl, sætFejl] = useState<string | null>(null);',
      '    return <Text onPress={() => sætFejl(\'x\')}>{fejl}</Text>;',
      '  }',
      '  return null;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([
      'syntetisk.tsx:3  Kort: useState() ligger under en IfStatement',
    ]);
  });

  it('ser en krog i en tilbagekaldelse', () => {
    const kode = [
      'export function Vinge() {',
      '  useEffect(() => {',
      '    const [x] = useState(0);',
      '    log(x);',
      '  }, []);',
      '  return null;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([
      'syntetisk.tsx:3  Vinge: useState() ligger i en tilbagekaldelse, ikke i komponentens krop',
    ]);
  });

  it('lader en krog være, når den er i return-sætningen selv', () => {
    // Målt form, ikke antaget: `use-today.ts` og `notify.ts` returnerer
    // `{ useToday, ... }` — krogen i objektet er ikke en krog *efter* return.
    const kode = [
      'export function useMin() {',
      '  const [n, sæt] = useState(0);',
      '  return {',
      '    n,',
      '    sæt,',
      '    fordoblet: useMemo(() => n * 2, [n]),',
      '  };',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.ts', kode)).toEqual([]);
  });

  it('lader en krog være i en betinget udtryk, der ikke kalder krogen', () => {
    // `isLoading ? <A/> : <B/>` er en betingelse, men ingen krog under den.
    const kode = [
      'export function Vægt({ vis }: { vis: boolean }) {',
      '  const [n] = useState(0);',
      '  return vis ? <Text>{n}</Text> : null;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('dømmer en egen krog, ikke krogene i en kalds funktion', () => {
    // `useTimer()` kalder selv tre kroge; de er *dets* ansvar. Porten skal kun
    // dømme, hvad der sker i den kaldende funktion.
    const kode = [
      'export function useSammen() {',
      '  const [a] = useState(0);',
      '  const b = useMemo(() => a + 1, [a]);',
      '  return useMemo(() => a + b, [a, b]);',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.ts', kode)).toEqual([]);
  });
});
