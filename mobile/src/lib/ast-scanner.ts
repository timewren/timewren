import { parse } from '@babel/parser';

/**
 * Fælles læsning af kilder for de porte, der dømmer kode de ikke renderer.
 *
 * Parseren er `@babel/parser`, ikke `typescript` (opgave 7i): TypeScript 7
 * udkommer kun som den native `tsc` og har intet JavaScript-API, så
 * `createSourceFile`, `forEachChild`, `isJsx*` og `findAncestor` forsvinder.
 * Babel-parseren er et dev-værktøj uden den afhængighed, den ligger allerede
 * i træet gennem Expo's babel-preset, og den giver præcis de to ting portene
 * bruger: noder med `start`/`end` i kilden (så værdier læses som rå tekst med
 * `kode.slice`) og `loc.start.line`.
 *
 * Noderne er her *kun* formindret — portene dømmer form, ikke typer, så en
 * fuldstændig `@babel/types`-model ville være mærkbar kode uden dækning.
 * Derfor læses egenskaberne gennem `vaerk`, der siger hvad der forventes.
 */
export type Node = {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number } } | null;
  [noegle: string]: unknown;
};

/** En JSX-node der har en `attributes`-liste. */
export type Element = Node & { attributes: Node[] };

/**
 * Felter der ikke er børn. `loc`/`start`/`end` er tal, og `extra` bærer
 * rå-kilden for strenge — uden at springe dem over ville porten læse tal og
 * strenge som noder og gå i uendelig rekursion på cykliske `__`-felter.
 */
const IKKE_BOERN = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

/**
 * Parser én kildefil. Ingen `errorRecovery`: en fil porten ikke kan læse skal
 * stoppe gaten, ikke springes over — en port der hopper over den fil, den
 * ikke forstår, er grøn fordi den er døv.
 */
export function parseKode(kode: string): Node {
  return parse(kode, { sourceType: 'module', plugins: ['jsx', 'typescript'] }) as unknown as Node;
}

/** Børnene i dokumentrækkefølge, som noder. `type`-løse værdier springs over. */
export function boern(node: Node): Node[] {
  const fundet: Node[] = [];
  for (const noegle of Object.keys(node)) {
    if (IKKE_BOERN.has(noegle))
      continue;
    const vaerdi = node[noegle];
    if (Array.isArray(vaerdi)) {
      for (const element of vaerdi) {
        if (erNode(element))
          fundet.push(element);
      }
    }
    else if (erNode(vaerdi)) {
      fundet.push(vaerdi);
    }
  }
  return fundet;
}

function erNode(vaerdi: unknown): vaerdi is Node {
  return typeof vaerdi === 'object' && vaerdi !== null && typeof (vaerdi as Node).type === 'string';
}

/**
 * Hver node i træet, dybde først. Tilbagevender fra hver knudes børn, så en
 * port kan selv bestemme om et undertræ skal med — en `View` med en fast
 * højde skal dømmes for sig selv og ikke som en del af sin forælder.
 */
export function gaas(rod: Node, gaa: (node: Node) => boolean | void): void {
  if (gaa(rod) === false)
    return;
  for (const barn of boern(rod))
    gaas(barn, gaa);
}

/**
 * Hver node med sine forfædre — rod først, den node selv sidst i `stak`.
 * Det er babel-modstykket til `ts.findAncestor`: parent-peg er en cyklisk
 * struktur, parseren bygger dem ikke, så stakken holdes undervejs. `gaa`
 * kan returnere `false` for at springe et undertræ over.
 */
export function gaasMedStak(rod: Node, gaa: (node: Node, stak: Node[]) => boolean | void): void {
  const stak: Node[] = [];
  const ned = (node: Node): void => {
    stak.push(node);
    if (gaa(node, stak) !== false) {
      for (const barn of boern(node))
        ned(barn);
    }
    stak.pop();
  };
  ned(rod);
}

/** Nærmeste forfæder, der opfylder `betingelse` — eller `undefined`. */
export function forfælder(stak: Node[], betingelse: (node: Node) => boolean): Node | undefined {
  for (let i = stak.length - 2; i >= 0; i--) {
    if (betingelse(stak[i]))
      return stak[i];
  }
  return undefined;
}

/**
 * Babel kalder et selvlukket og et åbent element begge JSX, og kun det første
 * bærer børn. Portene dømmer attributterne, så de vil se den *åbne* side.
 */
export function aabentElement(node: Node): Element | undefined {
  if (node.type === 'JSXElement')
    return vaerk<Node & Element>(node, 'openingElement');
  if (node.type === 'JSXSelfClosingElement' || node.type === 'JSXOpeningElement')
    return node as Element;
  return undefined;
}

/** Er noden en JSX-side, der bærer attributter? */
export function erElement(node: Node): boolean {
  return node.type === 'JSXElement' || node.type === 'JSXSelfClosingElement' || node.type === 'JSXOpeningElement';
}

/**
 * Det *selvlukkede* elements åbne side, hvis elementet er lukket med `/>`.
 *
 * TypeScript har to node-typer (`JsxSelfClosingElement` og
 * `JsxOpeningElement`); babel har én, hvor et selvlukket element er et
 * `JSXElement` med `openingElement.selfClosing = true`. En port, der skal
 * dømme *kun* selvlukkede elementer (`<StatTile … />` men ikke
 * `<StatTile …>…</StatTile>`, fordi den kun vil se de korte), kan derfor ikke
 * skelne på nodetypen — den skal se på flaget.
 *
 * Derfor er det **kun** `JSXOpeningElement`, der svarer: en gåtur over træet
 * møder både `JSXElement`-beholderen og dens `openingElement`, og svarer
 * begge, dømmes den samme etiket to gange. Linjen er den samme, fordi de to
 * noder starter samme sted.
 */
export function selvlukket(node: Node): Element | undefined {
  return node.type === 'JSXOpeningElement' && node.selfClosing === true ? (node as Element) : undefined;
}

/** Værdien af en egenskab, som den type porten forventer. */
export function vaerk<T>(node: Node, noegle: string): T | undefined {
  const vaerdi = node[noegle];
  return vaerdi === undefined || vaerdi === null ? undefined : (vaerdi as T);
}

/** Node(r) på stien, så længere veje kan skrives i ét udtryk. */
export function paa(node: Node | undefined, ...stien: string[]): Node | undefined {
  let nuværende = node;
  for (const noegle of stien)
    nuværende = nuværende ? vaerk<Node>(nuværende, noegle) : undefined;
  return nuværende;
}

/** Navnet på en identifikator — `View`, `data`, `height`. */
export function navn(node: Node | undefined): string | undefined {
  if (!node)
    return undefined;
  if (node.type === 'JSXIdentifier' || node.type === 'Identifier' || node.type === 'JSXNamespacedName')
    return vaerk<string>(node, 'name');
  return undefined;
}

/** Kilden for et udtryk — samme form som `node.getText()` i TypeScript. */
export function tekst(kode: string, node: Node | undefined): string {
  return node ? kode.slice(node.start, node.end) : '';
}

/** Linjen i kilden, 1-talt — samme form som `getLineAndCharacterOfPosition().line + 1`. */
export function linje(node: Node): number {
  return node.loc?.start.line ?? 0;
}

/** En attributs værdi som *rå tekst*, også når den er et udtryk. */
export function attributTekst(kode: string, element: Element, navnlig: string): string | undefined {
  const attribut = element.attributes.find(
    a => a.type === 'JSXAttribute' && navn(paa(a, 'name')) === navnlig,
  );
  return attribut ? tekst(kode, paa(attribut, 'value')) : undefined;
}

/**
 * De attributter, hvis navn opfylder `betingelse`. Et element uden
 * `attributes` (et `JSXElement` der ikke er åbnet endnu) har ingen, så listen
 * er tom frem for et kast — porten skal dømme, ikke dræbe gaten.
 */
export function attributter(element: Node | undefined, betingelse: (navn: string) => boolean): Node[] {
  return (vaerk<Node[]>(element as Node, 'attributes') ?? []).filter(
    a => a.type === 'JSXAttribute' && betingelse(navn(paa(a, 'name')) ?? ''),
  );
}

/**
 * Er noden et kald? `?.` giver `OptionalCallExpression` i babel, så en port
 * der kun kender `CallExpression` dør på `data?.map(…)` — altså præcis den
 * valgfri adgang, der er almindelig i en app der læser `kald.data`.
 */
export function erKald(node: Node | undefined): boolean {
  return node?.type === 'CallExpression' || node?.type === 'OptionalCallExpression';
}

/** Er noden et medlem — `a.b` eller `a?.b` — der læses med punktum? */
export function erMedlem(node: Node | undefined): boolean {
  return (node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression') && node?.computed !== true;
}

/** Er noden en funktion — babel-modstykket til `ts.isFunctionLike`. */
export function erFunktion(node: Node): boolean {
  return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod'].includes(node.type);
}
