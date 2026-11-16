import type { Node } from './ast-scanner';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributter, erFunktion, erKald, forfælder, gaas, gaasMedStak, linje, navn, paa, parseKode, tekst, vaerk } from './ast-scanner';

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
 * to former som `empty-state-error`, `stat-tile-error` og `field-value-error`
 * læser. Kun `useQuery` er et kald: `trpc.useUtils()` har ingen data at vise,
 * og en mutations `data` er resultatet af sidste kørsel.
 */
type Kald = {
  /** Hvad fundet skal navngive, så en læser kan finde kallet i koden. */
  rapport: string;
  /** Matcher en læsning af kaldets værdi. */
  vaerdi: RegExp;
  /**
   * Matcher kaldets egen `isError` — i props, i en betingelse eller i en
   * fejlgren. `isSuccess` tæller med, fordi skærmene bruger det som det
   * ærlige alternativ: `tittel={members.isSuccess ? … : …}`.
   */
  flag: RegExp;
  /** Matcher kaldets *værdi* i en prop, så en betingelse kan undersøge fravær. */
  kaldNavn: string;
};

function navngivetKald(kode: string): Kald[] {
  return Array.from(kode.matchAll(new RegExp(`const\\s+(${NAVN})\\s*=\\s*trpc\\.[^(\\s]+\\.useQuery\\s*\\(`, 'gu')), ([, navn]) => ({
    rapport: navn,
    vaerdi: new RegExp(`${ORD(navn)}\\s*\\??\\.data\\b`),
    flag: new RegExp(`${ORD(navn)}\\s*\\??\\.\\s*(isError|isSuccess)\\b`),
    kaldNavn: navn,
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
      // Sidste alternativ er en *nøgen* betingelse: `if (isError) return …`.
      // Ellers ville et kald skrevet destruktureret aldrig dækkes af sin egen
      // fejlvagt, fordi der ikke står et tegn bagefter at kræve.
      flag: new RegExp(svar ? `(?<!\\.)${ORD(svar)}\\s*(\\?\\?|\\?|\\.|&&|\\|\\||\\)|\\]|\\}|$)` : /\\bfindes_aldrig\\b/),
      kaldNavn: vaerdi,
    });
  }
  return fund;
}

/** Kalde i én funktion, med de destrukturerede deklarationer fjernet fra resten. */
function kalde(kode: string): { kald: Kald[]; resten: string } {
  return {
    kald: [...navngivetKald(kode), ...destruktureretKald(kode)],
    resten: kode.replace(DESTRUKTURERET, ''),
  };
}

/**
 * Afledte `const`, transitivt: `const antal = kald.data?.length ?? 0` giver ét
 * niveau, `const synlige = antal > 0 ? antal : 0` giver to. Det er *værdien*
 * der flytter sig, så porten skal følge med — ellers er `hint={antalTekst}`
 * usynlig, selv om `antalTekst` stammer fra et kald.
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
        if (k.vaerdi.test(rhs))
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

/** Hvilke kald der føder en værdi — kaldet selv eller en afledt `const`. */
function naaer(vaerdi: string, kald: Kald[], afledt: Map<string, Set<Kald>>): Set<Kald> {
  const naaer = new Set<Kald>();
  for (const k of kald) {
    if (k.vaerdi.test(vaerdi))
      naaer.add(k);
  }
  for (const [navn, kilder] of afledt) {
    if (new RegExp(`[({=,?\\s]${ORD(navn)}`).test(vaerdi))
      kilder.forEach(k => naaer.add(k));
  }
  return naaer;
}

/**
 * Props der *læser* noget for brugeren: et tal, et navn, en sætning. Her er
 * forskellen fra `field-value-error`: de props *fylder* noget (en liste, en
 * vælger), mens disse *beskriver* — og derfor kan et fejlet kald levere en
 * sætning, der ligner sandhed.
 *
 * Navnene er fra koden, ikke en liste over komponenter, så en ny komponent med
 * et nyt navn dømmes uden at porten læres op.
 */
const LAESER = new Set([
  'hint',
  'label',
  'placeholder',
  'accessibilityLabel',
  'a11yLabel',
  'description',
  'helperText',
  'emptyText',
  'errorText',
  'title',
  'subtitle',
  'unit',
  'suffix',
]);

/**
 * Sætter en skabelon sammen om en læsning af et kald. Skrevet sådan, fordi en
 * `${…}` i en streng er et skabelon-udtryk i denne fil, når den skal være kode
 * i den syntetiske kilde.
 */
const INDSAT = (foran: string, indhold: string, efter: string) => `${foran}\${${indhold}}${efter}`;

/** Tekst i `'` og `"` er indhold, ikke kode. */
function udenStrenge(tekst: string): string {
  return tekst.replace(/'[^']*'|"[^"]*"/g, '""');
}

/**
 * Er udtrykket en kæde? Babel kalder `&&`, `||` og `??` `LogicalExpression`,
 * mens TypeScript gjorde dem til `BinaryExpression`. Kæderne afgør om et kald
 * har leveret, så porten skal kende begge — uden `LogicalExpression` taber
 * både betingelserne i prop-kæden og reglen om en tom anden gren.
 */
function erKæde(node: Node): boolean {
  return node.type === 'BinaryExpression' || node.type === 'LogicalExpression';
}

/**
 * De dele af en værdi, der *varierer* — en skabelon, en `translate(…)` der
 * tæller, eller `String(…)` af et tal. Kun de dele kan være en påstand: en
 * etiket (`data.name`) bliver tom, når kallet fejler, og en statisk erstatning
 * (`?? 'Ukendt'`) siger intet om serverens data.
 *
 * En erstatning *udenfor* de dele tæller ikke: `navn || translate('profil')`
 * viser en statisk etiket, når navnen mangler — det er ikke en påstand om
 * holdet. Derfor skal den aflede reference ligge *inde i* den variierende del.
 */
function varierendeDele(kode: string, node: Node | undefined): string[] {
  const dele: string[] = [];
  if (!node)
    return dele;
  gaas(node, (n) => {
    // Babel har én `TemplateLiteral` for begge former: `` `a` `` og `` `a${b}` ``.
    // Kun den med pladsholdere svarer til TypeScripts `TemplateExpression`, så
    // antallet af `expressions` er det, der skelner.
    const skabelon = n.type === 'TemplateLiteral' && (vaerk<Node[]>(n, 'expressions')?.length ?? 0) > 0;
    const talt = erKald(n) && ['translate', 'String'].includes(navn(paa(n, 'callee')) ?? '');
    if (skabelon || talt) {
      dele.push(udenStrenge(tekst(kode, n)));
    }
  });
  return dele;
}

/** Hver prop der læser, med den node dens værdi står i. */
function laesendeProps(node: Node): { navn: string; vaerdi?: Node }[] {
  return attributter(node, n => LAESER.has(n)).map((p) => {
    const værdi = paa(p, 'value');
    // `hint={antal}` er en `JSXExpressionContainer` om et udtryk; `hint="…"` er
    // en streng og `hint` ingenting. Kun den første bærer kode, porten skal læse.
    return {
      navn: navn(paa(p, 'name')) ?? '',
      vaerdi: værdi?.type === 'JSXExpressionContainer' ? paa(værdi, 'expression') : undefined,
    };
  });
}

/** Hver `const`-værdi i en funktion, så en påstand kan følges gennem dem. */
function constNoder(node: Node | undefined): Map<string, Node> {
  const fund = new Map<string, Node>();
  if (!node)
    return fund;
  gaas(node, (n) => {
    if (n.type !== 'VariableDeclaration')
      return;
    // Babel lægger alle navne i én deklaration: `const a = 1, b = 2;` er *én*
    // `VariableDeclaration` med to `VariableDeclarator`, mens TypeScript havde
    // én deklaration pr. navn. Derfor løber porten deklaratorerne — ellers så
    // den slet ingen `const`, fordi `id` og `init` ligger på dem, ikke på
    // deklarationen.
    for (const deklarator of vaerk<Node[]>(n, 'declarations') ?? []) {
      const navnNode = paa(deklarator, 'id');
      // Destrukturerede bindinger (`const { a, b } = …`) er ikke en værdi at
      // følge, så kun et navn tæller — samme skeln som før.
      if (navnNode?.type !== 'Identifier')
        continue;
      const værdi = paa(deklarator, 'init');
      if (værdi)
        fund.set(vaerk<string>(navnNode, 'name') ?? '', værdi);
    }
  });
  return fund;
}

/** De `const` en tekst læser, så påstanden kan følges gennem dem. */
function gennem(kode: string, consts: Map<string, Node>, laesning: string): Node[] {
  const fund: Node[] = [];
  const set = new Set<string>();
  // Maskeret, så `translate('reports.title')` ikke ligner en læsning af
  // `const title` — indhold er indhold, ikke kode.
  const kø: string[] = [udenStrenge(laesning)];
  while (kø.length > 0) {
    const læst = kø.pop() ?? '';
    for (const [navn, rhs] of consts) {
      if (set.has(navn) || !new RegExp(ORD(navn)).test(læst))
        continue;
      set.add(navn);
      fund.push(rhs);
      kø.push(udenStrenge(tekst(kode, rhs)));
    }
  }
  return fund;
}

/**
 * `kald ? <påstand> : undefined` er den ærlige skriveform for en undertitel
 * eller et hint: et kald der fejlede har ingen data, så den anden gren er
 * tom, og brugeren læser intet. Det er den almindeligste skriveform i appen
 * (otte skærme), så uden reglen ville porten melde dem alle som fund.
 */
const TOM_GREN = /(:|\?\?|\|\|)\s*(undefined|null|"")\s*$/;

function erElement(node: Node): boolean {
  // Babel har én JSX-node for begge former: et selvlukket `<Text />` er et
  // `JSXElement` med `openingElement.selfClosing = true`. Kun den *åbne* side
  // svarer — `JSXElement`-beholderen skal ikke, ellers dømmes hvert element
  // to gange, fordi gåturen møder den og dens `openingElement`.
  return node.type === 'JSXOpeningElement';
}

/** Værdierne i alle props på et element, med indhold maskeret væk. */
function propVærdierFor(kode: string, node: Node): string[] {
  return attributter(node, () => true)
    .filter(p => !!paa(p, 'value'))
    .map(p => udenStrenge(tekst(kode, paa(p, 'value'))));
}

const KÆDER = ['&&', '||', '??'];

/**
 * Betingelsen i et `if` eller en ternæ. Begge steder hedder feltet `test` i
 * babel, så de er én funktion — i TypeScript hed de `expression` og
 * `condition`.
 */
function betingelse(node: Node): Node | undefined {
  return node.type === 'IfStatement' || node.type === 'ConditionalExpression' ? paa(node, 'test') : undefined;
}

function erBetingelse(node: Node): boolean {
  if (betingelse(node))
    return true;
  return erKæde(node) && !!paa(node, 'left') && !!paa(node, 'right') && KÆDER.includes(vaerk<string>(node, 'operator') ?? '');
}

/**
 * Dækker en betingelse kallet? Den skal undersøge kaldets fejlflag
 * (`clients.isError`) eller *værdiens fravær* (`!data`) — for uden data er der
 * kun to grunde: endnu ikke hentet eller fejlet, og da er der noget at sige.
 *
 * `!antal` hvor `antal` er kaldets *afledte* værdi dækker ikke: en fejlet
 * `clients.list` giver lige så vel 0, så det er præcis den stilhed porten
 * skal fange. Derfor læses kun selve kaldets navn og et rent alias af værdien.
 */
function daekker(betingelse: string, k: Kald, aliaser: Set<string>): boolean {
  if (k.flag.test(betingelse))
    return true;
  const fravær = [...aliaser].some(navn => new RegExp(`(^|\\W)(!\\s*${ORD(navn)}\\b|${ORD(navn)}\\s*(===|==)\\s*(undefined|null)\\b)`).test(betingelse));
  return fravær || new RegExp(`(^|\\W)!\\s*${ORD(k.kaldNavn)}\\b`).test(betingelse);
}

/** Navne der er et rent alias af kaldets værdi: `const data = query.data`. */
function aliaser(kode: string, kald: Kald[]): Set<string> {
  const fund = new Set<string>();
  for (const m of kode.matchAll(new RegExp(`const\\s+(${NAVN})\\s*=\\s*([^;]+);`, 'gu'))) {
    const [, navn, rhs] = m;
    const ren = rhs.trim().replace(/^[(!]+|[)!]+$/g, '').trim();
    if (kald.some(k => k.vaerdi.test(ren)) && !/[[({]/.test(ren))
      fund.add(navn);
  }
  return fund;
}

/**
 * En tidligere `if`-sætning i samme funktion, der **afslutter** på kaldets
 * fejl: `if (kald.isError || !kald.data) return <ErrorState … />`. Det er den
 * mest almindelige fejlform i appen, og den ligger i *sætnings*-rækken —
 * ikke i JSX-forfædrene — så uden denne ville hver skærm med en
 * forhentningsskærm være et fund.
 *
 * Kun en sætning *før* påstanden tæller, fordi den ellers ville dække sin egen
 * fejlgren og skjule de fund, porten skal finde.
 */
function tidligereVagt({ kode, stak }: Kontekst, k: Kald, alias: Set<string>): boolean {
  // Sætningen selv og dens forfædre i rækkefølgen — den første, hvis forælder
  // er en blok, er den sætning vi står i.
  let i = stak.length - 1;
  while (i > 0 && stak[i - 1].type !== 'BlockStatement')
    i--;
  if (i === 0)
    return false;
  for (const forrige of vaerk<Node[]>(stak[i - 1], 'body') ?? []) {
    if (forrige === stak[i])
      return false;
    if (forrige.type !== 'IfStatement')
      continue;
    if (!daekker(tekst(kode, paa(forrige, 'test')), k, alias))
      continue;
    const afslutter = paa(forrige, 'consequent');
    if (afslutter?.type === 'ReturnStatement' || tekst(kode, afslutter).includes('throw '))
      return true;
  }
  return false;
}

/** Alt en dømmelse af én prop har brug for at se omkring sig. */
type Kontekst = {
  prop: { vaerdi?: Node };
  kald: Kald[];
  resten: string;
  consts: Map<string, Node>;
  afledt: Map<string, Set<Kald>>;
  tomGren: boolean;
  propVærdier: string[];
  betingelser: string[];
  /** Hele kilden, for råt uddrag af noder. */
  kode: string;
  /** Elementet og dets forfædre — rod først, elementet selv sidst. */
  stak: Node[];
};

/**
 * Dømmer én læsende prop: hvilke kald leverer en påstand til den, som ingen
 * fejlgren dækker. Dækningsmulighederne er samlet her, så `scanSource` kun
 * skal finde kaldene og deres forfædre.
 */
function uvedhovedet(kontekst: Kontekst): Kald[] {
  const { prop, kald, resten, consts, afledt, tomGren, propVærdier, betingelser, kode } = kontekst;
  if (!prop.vaerdi)
    return [];
  const noder = [prop.vaerdi, ...gennem(kode, consts, tekst(kode, prop.vaerdi))];
  const dele = noder.flatMap(n => varierendeDele(kode, n));
  if (dele.length === 0)
    return [];
  // En tom anden gren dækker: `hint={antal ? … : undefined}` skriver intet,
  // når kallet ikke har leveret — det er den ærlige form.
  if (noder.some(n => TOM_GREN.test(udenStrenge(tekst(kode, n)).trim())))
    return [];
  if (tomGren)
    return [];
  return [...naaer(dele.join(' '), kald, afledt)].filter((k) => {
    const alias = aliaser(resten, [k]);
    return !propVærdier.some(p => k.flag.test(p))
      && !betingelser.some(b => daekker(b, k, alias))
      && !tidligereVagt(kontekst, k, alias);
  });
}

function scanSource(file: string, source: string): string[] {
  const ast = parseKode(source);
  const fund: string[] = [];

  // Elementet og dets forfædre op til funktionens kant. `gaasMedStak` giver
  // hele stakken, så kæden er de sidste led — og det er samme kæde, porten
  // læste som `n.parent`-kæden.
  gaasMedStak(paa(ast, 'program') ?? ast, (node, stak) => {
    if (!erElement(node))
      return;
    const props = laesendeProps(node);
    if (props.length === 0)
      return;
    // Kalde, afledte og betingelser læses i det yderste funktionsled: en
    // `.map`-række maler elementer i en indre funktion, men både værdien og
    // fejlgrenen kommer udenfra. Uden en funktionforfældre er hele filen
    // leddet — samme fallback som `findAncestor(isSourceFile)` før.
    const egen = forfælder(stak, erFunktion);
    const kode = egen ? tekst(source, egen) : source;
    const { kald, resten } = kalde(kode);
    const afledt = afledte(resten, kald);
    const consts = constNoder(egen);

    // Dækning må komme tre steder fra: en prop på elementet selv eller en af
    // dets forfædre (`error={x.isError}`, `<SectionState isError={…}>`), en
    // betingelse i rækkefølgen ovenfor, eller en tidligere `if` der afslutter.
    // Uden forfædre ville `SectionState` være usynlig, og den er netop den
    // komponent, de otte overblikssektioner bruger. Vandringen stopper ved
    // funktionens kant: en ydre komponent må ikke dække en påstand, den ikke maler.
    const kæde: Node[] = [];
    for (let i = stak.length - 1; i >= 0; i--) {
      kæde.push(stak[i]);
      if (stak[i] === egen)
        break;
    }
    const betingelser: string[] = [];
    for (const n of kæde) {
      const hvilken = betingelse(n);
      if (hvilken)
        betingelser.push(tekst(source, hvilken));
      else if (erKæde(n) && paa(n, 'left') && paa(n, 'right') && erBetingelse(n))
        betingelser.push(tekst(source, paa(n, 'left')), tekst(source, paa(n, 'right')));
    }
    // Dækning læses i propværdierne — også i de `const` de læser, fordi
    // skærmene skriver `titel={titel}` og dømmer i `const titel = …`.
    const propVærdier: string[] = [];
    for (const n of kæde) {
      const element = erElement(n) ? n : paa(n, 'openingElement');
      for (const værdi of element ? propVærdierFor(source, element) : []) {
        propVærdier.push(værdi);
        for (const c of gennem(source, consts, værdi))
          propVærdier.push(udenStrenge(tekst(source, c)));
      }
    }
    // Det samme gælder en tom gren i *rækkefølgen ovenfor*: `kald && <påstand>`
    // skriver intet, når kallet ikke har leveret.
    const tomGren = kæde.some((n) => {
      if (n.type === 'ConditionalExpression')
        return erTom(source, paa(n, 'alternate'));
      return erKæde(n) && KÆDER.includes(vaerk<string>(n, 'operator') ?? '') && erTom(source, paa(n, 'right'));
    });

    for (const prop of props) {
      const uvedhovedede = uvedhovedet({ prop, kald, resten, consts, afledt, tomGren, propVærdier, betingelser, kode: source, stak });
      if (uvedhovedede.length > 0)
        fund.push(`${file}:${linje(node)}  <${navn(paa(node, 'name'))} ${prop.navn}> ${uvedhovedede.map(k => k.rapport).join(', ')}`);
    }
  });
  return fund;
}

/**
 * En gren der viser intet: `undefined`, `null` eller en tom streng.
 *
 * En skabelon uden pladsholdere er også en streng, så den tæller med. I stedet
 * for at læse `quasis[0].value.cooked` sammenligner porten det rå uddrag med
 * to bagslidser — en skabelons `start`/`end` ligger lige ved ranserne, så der
 * kan ikke være mellemrum at tage fejl af.
 */
function erTom(kode: string, node: Node | undefined): boolean {
  if (!node)
    return true;
  if (node.type === 'NullLiteral')
    return true;
  if (node.type === 'Identifier')
    return vaerk<string>(node, 'name') === 'undefined';
  if (node.type === 'StringLiteral')
    return vaerk<string>(node, 'value') === '';
  return node.type === 'TemplateLiteral'
    && (vaerk<Node[]>(node, 'expressions')?.length ?? 0) === 0
    && tekst(kode, node) === '``';
}

/**
 * Et kald der fejler, og så skriver en *påstand* i stedet for en værdi —
 * opgave 6.20.
 *
 * 6.14 dømte tal, 6.18 domte tomhed, og 6.19 dømte lister der fyldte et felt.
 * Det her er den sidste af de fire måder et kald kan svare på: skærmen skriver
 * en sætning, der *beskriver* noget der aldrig kom — "0 medlemmer", "Ukendt",
 * et interpoleret antal i en skærmlæser-label. Sætningen læses højt og ligner
 * en rigtig oplysning, så en skærmlæser-bruger hører "Ingen registrerede tider"
 * om en kunde der har registreret en halv million.
 *
 * Kendte grænser, så næste iteration ikke læser porten som en løsning:
 * - Porten dømmer kun props der *læser* for brugeren. Et tal i `value` dømmes af
 *   `stat-tile-error`, en tom liste i `options` af `field-value-error`.
 * - En påstand skal *variere* med kallet. `title={data.name}` og
 *   `navn ?? 'Ukendt'` er etiketter, ikke påstande — de siger intet om
 *   serverens data. Kopier som sådan er et redaktionsspørgsmål, ikke plumb.
 * - Dækning tæller kun når den læser netop *dette* kalds `isError`/`isSuccess`,
 *   når kaldets egen værdi testes for fravær, eller når den anden gren er tom.
 *   Et `ErrorState` for et nabo-kald dækker ikke, fordi det er et andet kald
 *   der kan fejle.
 */
describe('et kald må ikke levere en påstand, når det fejlede', () => {
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
});

/** Hvad porten skal se: de fejlformer den er bygget til. */
describe('portens fund', () => {
  it('kan overhovedet se en påstand fra et fejlet kald', () => {
    const kode = [
      'export function A() {',
      '  const live = trpc.team.liveTimers.useQuery();',
      '  return <StatTile label="Team" value="1" hint={translate(live.data?.length === 1 ? "one" : "other", { count: live.data?.length ?? 0 })} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <StatTile hint> live']);
  });

  it('ser en påstand i en interpoleret skærmlæser-label', () => {
    const kode = [
      'export function B() {',
      '  const entries = trpc.time.list.useQuery({});',
      INDSAT('  return <View accessibilityLabel={`', 'entries.data?.length ?? 0', '} registrerede tider`} />;'),
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <View accessibilityLabel> entries']);
  });

  it('ser en påstand gennem to led af afledte const', () => {
    const kode = [
      'export function C() {',
      '  const clients = trpc.clients.list.useQuery();',
      '  const antal = clients.data?.length ?? 0;',
      '  const tekst = translate(antal === 1 ? "one" : "other", { count: antal });',
      '  return <Text hint={tekst} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:5  <Text hint> clients']);
  });
});

/** Hvad porten lader være: de ærlige former, den ikke skal male som fund. */
describe('portens grænser', () => {
  it('lader en påstand være, når elementet selv bærer kaldets fejl', () => {
    const kode = [
      'export function D() {',
      '  const live = trpc.team.liveTimers.useQuery();',
      '  return <StatTile error={live.isError} label="Team" value="1" hint={translate("other", { count: live.data?.length ?? 0 })} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en påstand være under en forfæder der bærer kaldets fejl', () => {
    const kode = [
      'export function E() {',
      '  const live = trpc.team.liveTimers.useQuery();',
      '  return (',
      '    <SectionState isLoading={live.isLoading} isError={live.isError} onRetry={() => {}}>',
      '      <StatTile label="Team" value="1" hint={translate("other", { count: live.data?.length ?? 0 })} />',
      '    </SectionState>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en påstand være, når forældren maler kaldets fejl', () => {
    const kode = [
      'export function F() {',
      '  const live = trpc.team.liveTimers.useQuery();',
      '  return live.isError',
      '    ? <ErrorState onRetry={() => void live.refetch()} />',
      '    : <StatTile label="Team" value="1" hint={translate("other", { count: live.data?.length ?? 0 })} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en påstand være, når den kun skrives når kallet svarede', () => {
    const kode = [
      'export function K() {',
      '  const members = trpc.organization.getMembers.useQuery();',
      '  const liste = members.data ?? [];',
      INDSAT('  return <SectionHeader title={members.isSuccess ? `Medlemmer (', 'liste.length', ')` : `Medlemmer`} />;'),
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('dømmer hvert kald for sig, ikke funktionen for alle', () => {
    const kode = [
      'export function G() {',
      '  const live = trpc.team.liveTimers.useQuery();',
      '  const projects = trpc.projects.list.useQuery();',
      '  return (',
      '    <>',
      '      <ErrorState onRetry={() => void live.refetch()} />',
      '      <StatTile error={live.isError} label="Projekter" value="1" hint={String(projects.data?.length ?? 0)} />',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:7  <StatTile hint> projects']);
  });

  it('lader en påstand være, der ikke kommer fra et kald', () => {
    const kode = [
      'export function H() {',
      '  const antal = 3;',
      '  return <Text hint={String(antal)} accessibilityLabel="tre poster" />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('ser ikke et dansk ord i en tekst som et kald', () => {
    const kode = [
      'export function I() {',
      '  const live = trpc.team.liveTimers.useQuery();',
      '  return <Text hint="Kunne ikke hente holdet." accessibilityLabel="Ingen data" />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual([]);
  });

  it('lader en påstand være, når kaldet er slået fra uden at fejle', () => {
    const kode = [
      'export function J() {',
      '  const week = trpc.team.weekOverview.useQuery({ weekStart }, { enabled: caps.isAdmin });',
      '  return <StatTile label="Uge" value="0 t" hint={translate("other", { count: week.data?.length ?? 0 })} />;',
      '}',
    ].join('\n');
    expect(scanSource('syntetisk.tsx', kode)).toEqual(['syntetisk.tsx:3  <StatTile hint> week']);
  });
});
