import type { Element, Node } from './ast-scanner';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aabentElement, attributTekst, attributter, boern, gaas, linje, paa, parseKode, tekst, vaerk } from './ast-scanner';
import { MAX_GROWTH, textSafeHeight } from './text-scale';

/**
 * `h-9`, `h-11` … men *ikke* `min-h-9`, `max-h-9`, `h-full` eller `h-1/2`
 * (en brøkdel af forældrenes højde, ikke en fast pixelhøjde).
 */
const FAST_HOEJDE = /(?<![\w-])h-(\d+)(?![\w./-])/;

/**
 * De to komponenter, der må have en fast højde over tekst.
 *
 * `Button` gør den selv til en *mindste* højde med `textSafeHeight`, så den
 * vokser med systemets skrift — det er præcis den rettelse 6.10 lavede, og
 * undtagelsen er derfor ikke en mangel, men et krav. Testen herunder verificerer
 * kravet, så en undtagelse aldrig kan blive en lækage: fjernes `textSafeHeight`
 * fra `button.tsx`, fejler porten. `IconButton` har intet i sig der skalerer —
 * kun et SVG-ikon i en 44 px kreds.
 */
const SELV_SIKRE = new Set(['Button', 'IconButton']);

describe('textSafeHeight', () => {
  it('lader grundhøjden være ved normal skriftstørrelse', () => {
    expect(textSafeHeight(44, 1)).toBe(44);
    expect(textSafeHeight(48, 1)).toBe(48);
  });

  it('vokser proportionelt med skriften', () => {
    expect(textSafeHeight(44, 1.5)).toBe(66);
    expect(textSafeHeight(48, 1.25)).toBe(60);
  });

  it('gør aldrig plads til teksten dårligere — heller ikke ved lille skrift', () => {
    for (const scale of [0.5, 0.85, 1, 1.1, 1.5, 2, 3.2, 10]) {
      expect(textSafeHeight(44, scale)).toBeGreaterThanOrEqual(44);
    }
  });

  it('klemmer væksten, så en knap ikke bliver højere end skærmen er bred', () => {
    expect(textSafeHeight(44, 2)).toBe(Math.round(44 * MAX_GROWTH));
    expect(textSafeHeight(44, 12)).toBe(Math.round(44 * MAX_GROWTH));
  });

  it('overlever en skriftstørrelse, der ikke er et tal', () => {
    expect(textSafeHeight(44, 0)).toBe(44);
    expect(textSafeHeight(44, -1)).toBe(44);
    expect(textSafeHeight(44, Number.NaN)).toBe(44);
  });

  it('giver et element uden højde videre uændret', () => {
    expect(textSafeHeight(0, 2)).toBe(0);
  });
});

/** Alle kildefiler under `src/` — porten læser dem, fordi den dømmer kode, den ikke renderer. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Den faste højde i pixels, hvis elementet har en — fra klasse eller inline-style. */
function fixedHeight(kode: string, open: Element): number | null {
  const fromClass = FAST_HOEJDE.exec(attributTekst(kode, open, 'className') ?? '');
  if (fromClass)
    return Number(fromClass[1]);
  const [style] = attributter(open, n => n === 'style');
  const object = paa(style, 'value', 'expression');
  if (!object || object.type !== 'ObjectExpression')
    return null;
  const [height] = (vaerk<Node[]>(object, 'properties') ?? []).filter(
    p => p.type === 'ObjectProperty' && tekst(kode, paa(p, 'key')) === 'height',
  );
  const vaerdi = paa(height, 'value');
  return vaerdi?.type === 'NumericLiteral' ? Number(vaerdi.value) : null;
}

/**
 * Renderer-elementer der *er* tekst, så en fast højde over et af dem også
 * dømmes — ikke kun over en `<Text>`. Holdt til de komponenter hvis eneste
 * opgave er at vise tekst; en `View` der kun rummer et ikon tæller ikke med.
 */
const TEKST_BÆRERE = new Set(['Text', 'StatTile', 'Badge', 'EmptyState', 'SectionHeader', 'ListRow', 'ScreenPlaceholder']);

/**
 * Tag-navnet som tekst, så `<Foo.Bar>` læses som `Foo.Bar` — ligesom før.
 * Babel kalder feltet `name` (TypeScript kaldte det `tagName`), og et navn
 * uden felt ville give en tom streng, der ingen undtagelse matcher.
 */
function tag(kode: string, open: Element): string {
  return tekst(kode, paa(open, 'name'));
}

/** Sand hvis der ligger tekst under `element`, som elementet selv ikke dømmer. */
function hasTextUnder(kode: string, element: Node): boolean {
  let found = false;
  const gaasInd = (current: Node) => {
    if (found)
      return false;
    const open = aabentElement(current);
    if (open) {
      if (TEKST_BÆRERE.has(tag(kode, open))) {
        found = true;
        return false;
      }
      // En indre fast højde dømmes for sig selv — ellers rapporteres den
      // værste skyldige, og en dybere rettelse tæller ikke som løst.
      if (fixedHeight(kode, open))
        return false;
    }
    return true;
  };
  for (const child of boern(element))
    gaas(child, gaasInd);
  return found;
}

/** Fund i én kildefil som `fil:linje  <Tag> h-N`. */
function scanSource(file: string, source: string): string[] {
  const ast = parseKode(source);
  const funder: string[] = [];
  gaas(paa(ast, 'program') ?? ast, (node) => {
    // Kun et element med børn: et selvlukket `<Text />` bærer ingen tekst,
    // der skal dømmes mod en forælders fast højde.
    if (node.type !== 'JSXElement')
      return;
    const open = aabentElement(node);
    if (!open)
      return;
    const height = fixedHeight(source, open);
    if (height && !SELV_SIKRE.has(tag(source, open)) && hasTextUnder(source, node))
      funder.push(`${file}:${linje(node)}  <${tag(source, open)}> h-${height}`);
  });
  return funder;
}

/**
 * Port mod fast højde på tekst — opgave 6.11.
 *
 * 6.10 rettede de fund den *kunne* se: `Button` gjorde sin `h-11` til en
 * voksende `minHeight`. Samme fejlform som fundene fra de tre forrige reviews —
 * en regel der dømmer de steder den kender. Uden en port kommer `h-9` på en
 * ny knap tilbage i næste måned, og ingen test kan se det, fordi det kun er
 * et layout-problem ved de store system-skrifter.
 *
 * Grænsen er bevidst og ærlig: porten læser JSX, ikke komponenter. Den dømmer
 * et element med en fast højde over tekst, og den ser ikke tekst, der opstår
 * inde i en komponent. Til gengæld læser den rigtigt, hvor en naiv regex
 * ville være forkert: `twMerge('h-9 …', …)`, templates og betingede klasser
 * tæller, fordi de står i `className`-attributtens tekst.
 */
describe('ingen fast højde må klippe tekst', () => {
  it('finder ingen i src/', () => {
    const root = join(__dirname, '..');
    const funder = sourceFiles(root).flatMap(file => scanSource(file.replace(root, 'src'), readFileSync(file, 'utf-8')));

    // Før porten fandt fast højde på tre steder: to kalenderdage
    // (`calendar-strip`, `date-field`) og diagrammets akse (`local-stats`).
    // Et dag-tal klippes ikke, det bare flytter sig ud af sin celle.
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

  it('kan overhovedet se en fast højde over tekst', () => {
    // Porten skal kunne fejle. Uden denne test er "fund ingen" lige så
    // sandt for en port, der slet ikke læser noget — præcis den fejlform
    // review-fundene har haft tre gange: en regel grøn fordi den er døv.
    const kode = 'export function A() {\n  return (\n    <View className="h-9 items-center">\n      <Text>7</Text>\n    </View>\n  );\n}\n';
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <View> h-9']);
  });

  it('ser også en fast højde skjult i twMerge, template og inline-style', () => {
    // En naiv regex ville være blind for alle tre, fordi højden ikke står i
    // et enkelt string-literal — og det er netop sådan de tre fund så ud.
    const kode = [
      'export function B() {',
      '  return (',
      '    <View className={twMerge(\'h-10 p-1\', x)}>',
      '      <Text>a</Text>',
      '    </View>',
      '  );',
      '}',
      'export function C() {',
      '  return <View style={{ height: 12 }}><Text>b</Text></View>;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([
      'syntetisk.tsx:3  <View> h-10',
      'syntetisk.tsx:9  <View> h-12',
    ]);
  });

  it('lader en voksende højde, en knap og en billedflade være', () => {
    const kode = [
      'export function D() {',
      '  return (',
      '    <>',
      '      <View className="min-h-9"><Text>d</Text></View>',
      '      <View className="max-h-9"><Text>e</Text></View>',
      // En brøkdel af forældrenes højde er ikke en fast højde — den følger den.
      '      <View className="h-1/2"><Text>f</Text></View>',
      '      <View className="h-full"><Text>g</Text></View>',
      '      <View className="h-9"><View className="size-4" /></View>',
      '      <Button className="h-14" label="Stop" />',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader kun de undtagelser være, der faktisk er værd at lade være', () => {
    const button = readFileSync(join(__dirname, '..', 'components', 'ui', 'button.tsx'), 'utf-8');

    // Uden denne linje er `Button` ikke en undtagelse, men en lækage: en fast
    // højde over tekst er præcis det, porten er sat op for at fange.
    expect(button).toContain('textSafeHeight');
    expect(button).toMatch(/minHeight/);
  });
});
