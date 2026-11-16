import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';

/**
 * Kilder under `src/` — porten læser dem, fordi den dømmer kode, den ikke renderer.
 *
 * Porten parser **ikke** med `typescript` (7i): TypeScript 7 udkommer kun som den
 * native `tsc` og har intet JavaScript-API, så hele compiler-API'et forsvinder.
 * `@babel/parser` er et dev-værktøj uden den afhængighed og bruges allerede
 * indirekte af Expo's babel-preset. Kun det, porten faktisk har brug for — JSX-
 * elementer, deres attributer og deres linje — læses. Ingen `errorRecovery`: en
 * fil porten ikke kan læse skal stoppe gaten, ikke springes over.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Elementer der svarer på et tryk. `hitSlop` er ikke en af dem — det er en udvidelse. */
const TRYKBAR = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight']);

/** WCAG 2.2 kræver 24×24 CSS-px. De 44 px er plattformens anbefaling til en finger. */
const MINIMUM_PX = 44;

/** Tailwinds afstand er 4 px pr. trin: `h-11` er 44 px, `size-9` er 36 px. */
const PX_PR_TRIN = 4;

type Maal = { klasse: string; px: number };

/**
 * Den faste størrelse i en `className`. `className` læses som *rå tekst*, også
 * når den er et udtryk (`twMerge('a', …)`), fordi en trykflade der skjuler sin
 * størrelse bag et kald stadig har den størrelse.
 *
 * Kun eksplicitte trin (`h-9`, `min-h-9`, `size-9`) tælles. `h-full`, `flex-1`
 * og `p-2` siger intet om den færdige flade, så de kan hverken bekræfte eller
 * afkræfte dommen — det er portens blinde plet, ikke en tilladelse.
 */
function stoerrelser(className: string): Maal[] {
  return Array.from(className.matchAll(/\b(size|h|min-h|w|min-w)-(\d+(?:\.\d+)?)\b/g))
    .map(([, klasse, trin]) => ({ klasse, px: Number(trin) * PX_PR_TRIN }))
    .filter(maal => maal.px < MINIMUM_PX);
}

/** Det babel-parseren kalder et JSX-element, uanset om det lukkes med `/>` eller ej. */
type JsxElement = {
  name?: { name?: string };
  loc: { start: { line: number } };
  attributes: {
    type: string;
    name?: { name?: string };
    value?: { start: number; end: number } | null;
  }[];
};

function elementer(kode: string): JsxElement[] {
  const ast = parse(kode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const fundet: JsxElement[] = [];
  const gaas = (vaerk: unknown) => {
    if (!vaerk || typeof vaerk !== 'object')
      return;
    if (Array.isArray(vaerk)) {
      vaerk.forEach(gaas);
      return;
    }
    const node = vaerk as Record<string, unknown>;
    if (node.type === 'JSXOpeningElement' || node.type === 'JSXSelfClosingElement')
      fundet.push(node as unknown as JsxElement);
    for (const noegle of Object.keys(node)) {
      if (noegle === 'loc')
        continue;
      gaas(node[noegle]);
    }
  };
  gaas(ast);
  return fundet;
}

/**
 * Værdien af en attribut som *rå tekst*, læst ud af kilden. Babel-parseren
 * giver positioner, ikke en udskrevet streng, så porten bruger kilden — samme
 * form som før, hvor `initializer.getText()` gjorde det.
 */
function attribut(vaerk: string, node: JsxElement, kode: string): string | undefined {
  const fundet = node.attributes
    .find(p => p.type === 'JSXAttribute' && p.name?.name === vaerk);
  return fundet?.value ? kode.slice(fundet.value.start, fundet.value.end) : undefined;
}

/**
 * Findene i én kildefil som `fil:linje  <Pressable> min-h-9=36px` — trykflader,
 * der er mindre end 44 px i den dimension, de har låst.
 *
 * En flade er dømt når den er trykbar, har en fast størrelse under 44 px og
 * ikke* udvider sit trygområde med `hitSlop`. `hitSlop` er appens egen
 * løsning på præcis denne port — `icon-button`, månedens pile i kalenderen og
 * `screen.tsx` bruger den — så den dømmes ikke.
 */
export function scanSource(fil: string, kode: string): string[] {
  const fund: string[] = [];

  for (const node of elementer(kode)) {
    const tag = node.name?.name;
    if (!tag || !TRYKBAR.has(tag) || attribut('hitSlop', node, kode) !== undefined)
      continue;
    const smaa = stoerrelser(attribut('className', node, kode) ?? '');
    if (smaa.length)
      fund.push(`${fil}:${node.loc.start.line}  <${tag}> ${smaa.map(m => `${m.klasse}=${m.px}px`).join(' ')}`);
  }
  return fund;
}

describe('touch-target (6.21)', () => {
  const src = join(__dirname, '..');
  const fund = sourceFiles(src).flatMap(fil => scanSource(relative(src, fil), readFileSync(fil, 'utf8')));

  it('finder ingen trykflade under 44 px i src/', () => {
    expect(fund).toEqual([]);
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
    const kilder = sourceFiles(src);
    expect(kilder.length).toBeGreaterThan(200);
    expect(kilder.filter(f => f.endsWith('-screen.tsx')).length).toBeGreaterThan(40);
    expect(kilder.some(f => f.endsWith(join('components', 'ui', 'button.tsx')))).toBe(true);
  });

  it('dømmer en pille på 36 px', () => {
    const kode = [
      'export function Pille() {',
      '  return <Pressable className="min-h-9 rounded-full px-3 py-1.5"><Text>15 min</Text></Pressable>;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:2  <Pressable> min-h=36px']);
  });

  it('dømmer begge dimensioner i en `size-N`', () => {
    // Farvevælgeren på kundeformularen: 36×36, så den rammer kun én finger.
    const kode = 'export const S = () => <Pressable accessibilityRole="button" className="size-9 rounded-full" />;';
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:1  <Pressable> size=36px']);
  });

  it('lader en flade på præcis 44 px være', () => {
    const kode = 'export const S = () => <Pressable className="min-h-11 size-11 rounded-full" />;';
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader `hitSlop` frikrive en lille flade', () => {
    // Appens egen løsning: synlig størrelse 36 px, trygområde 52 px.
    const kode = 'export const S = () => <Pressable hitSlop={8} className="size-9 rounded-full" />;';
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en flade uden fast størrelse være', () => {
    // `flex-1` og `h-full` siger intet om den færdige flade — dem skal porten
    // ikke dømme, for ellers ville den ramme enhver liste og række i appen.
    const kode = 'export const S = () => <Pressable className="flex-1 h-full p-3" />;';
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader et element, der ikke er trykbart, være lille', () => {
    // Et 24 px ikon i en `View` er ikke en trykflade; det får sin størrelse
    // fra den trykbare forælder. At dømme det ville være en fejl.
    const kode = 'export const S = () => <View className="size-6"><Badge label="ny" /></View>;';
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('læser `className` også når den er et udtryk', () => {
    const kode = 'export const S = () => <Pressable className={twMerge("min-h-9", val)} />;';
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:1  <Pressable> min-h=36px']);
  });

  it('tæller alle tre trykbare komponenter', () => {
    const kode = [
      'export const S = () => (',
      '  <View>',
      '    <TouchableOpacity className="h-8" />',
      '    <TouchableHighlight className="w-8" />',
      '  </View>',
      ');',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([
      'syntetisk.tsx:3  <TouchableOpacity> h=32px',
      'syntetisk.tsx:4  <TouchableHighlight> w=32px',
    ]);
  });
});
