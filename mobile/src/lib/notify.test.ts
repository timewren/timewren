import type { LoadSource } from './notify';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { showMessage as showToast } from 'react-native-flash-message';
import { announce, screenLoad, showMessage, useAnnounce, useAnnounceLoaded } from './notify';

jest.mock('react-native-flash-message', () => ({ showMessage: jest.fn() }));

const spoken = AccessibilityInfo.announceForAccessibility as jest.Mock;
const toasted = showToast as jest.Mock;

/** Roden alle portene læser. Deklareres her, så de ikke hver især finder den. */
const SRC_ROOT = join(__dirname, '..');

/** Alle kildefiler under `src/` — portene læser dem, fordi de dømmer kode, de ikke renderer. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('announce', () => {
  it('læser beskeden højt', () => {
    announce('Gemt: 1,25 t');
    expect(spoken).toHaveBeenCalledWith('Gemt: 1,25 t');
  });

  it('skærer trim-rummet fra, så en tom toast ikke læses', () => {
    announce('   ');
    expect(spoken).not.toHaveBeenCalled();
  });

  it('læser hver besked, også to ens i træk', () => {
    announce('Kunne ikke starte');
    announce('Kunne ikke starte');
    expect(spoken).toHaveBeenCalledTimes(2);
  });

  it('giver en stabil callback, så den må gå i en afhængighedsliste', () => {
    const { result, rerender } = renderHook(() => useAnnounce());
    const first = result.current;
    rerender(undefined);
    expect(result.current).toBe(first);
    first('Hej');
    expect(spoken).toHaveBeenCalledWith('Hej');
  });
});

describe('showMessage', () => {
  it('viser toasten OG læser den — en skærmlæser-bruger skal høre et gemt resultat', () => {
    showMessage({ message: 'Gemt: 1,25 t', type: 'success' });
    expect(toasted).toHaveBeenCalledWith({ message: 'Gemt: 1,25 t', type: 'success' });
    expect(spoken).toHaveBeenCalledWith('Gemt: 1,25 t');
  });

  it('læser beskrivelsen med, adskilt med et punktum', () => {
    showMessage({ message: 'Gemt offline: 2 t', description: 'Synkroniseres automatisk.', type: 'info' });
    expect(spoken).toHaveBeenCalledWith('Gemt offline: 2 t. Synkroniseres automatisk.');
  });

  it('læser også en fejl højt — den lå tidligere kun i toasten', () => {
    showMessage({ message: 'Tiden blev IKKE gemt (1,25 t). Timeren kører stadig — prøv igen.', type: 'danger' });
    expect(spoken).toHaveBeenCalledWith('Tiden blev IKKE gemt (1,25 t). Timeren kører stadig — prøv igen.');
  });
});

/**
 * Invariant: præcis én mekanisme.
 *
 * `accessibilityLiveRegion` er Android-only, så en app der bruger den OG
 * kalder `announceForAccessibility`, får TalkBack til at læse hver toast to
 * gange. Det kan ikke testes på en enhed her, så invarianten låses i koden.
 */
describe('ingen dobbeltlæsning på Android', () => {
  it('bruger ingen accessibilityLiveRegion i src/', () => {
    // Kun prop-`brug` tæller — navnen i en kommentar er ikke en live region.
    const alle = sourceFiles(SRC_ROOT);
    // Porten dømmer over ALT i `src/`, så dækningen er hele træet.
    forventDækning(alle, 200);
    const hits = alle
      .filter(file => /accessibilityLiveRegion\s*[=:]/.test(readFileSync(file, 'utf-8')));
    expect(hits).toEqual([]);
  });
});

describe('useAnnounceLoaded', () => {
  function load(props: Partial<LoadSource>) {
    return { isLoading: false, isError: false, ...props };
  }

  it('læser op, når en skeleton bliver til indhold', () => {
    const { rerender } = renderHook(
      ({ source }: { source: LoadSource }) => useAnnounceLoaded(source, 'Indhold indlæst'),
      { initialProps: { source: load({ isLoading: true }) } },
    );
    rerender({ source: load({}) });
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Indhold indlæst');
  });

  it('siger intet, når skærmen åbner med data i cache — der blev ikke ventet', () => {
    renderHook(() => useAnnounceLoaded(load({}), 'Indhold indlæst'));
    expect(spoken).not.toHaveBeenCalled();
  });

  it('kalder ikke "indlæst" for en fejl — den er en påstand om data, der ikke kom', () => {
    const { rerender } = renderHook(
      ({ source }: { source: LoadSource }) => useAnnounceLoaded(source, 'Indhold indlæst'),
      { initialProps: { source: load({ isLoading: true }) } },
    );
    rerender({ source: load({ isError: true }) });
    expect(spoken).not.toHaveBeenCalled();
  });

  it('tier under pull-to-refresh, fordi isLoading er false mens der genindlæses', () => {
    const { rerender } = renderHook(
      ({ source }: { source: LoadSource }) => useAnnounceLoaded(source, 'Indhold indlæst'),
      { initialProps: { source: load({ isLoading: true }) } },
    );
    rerender({ source: load({}) });
    rerender({ source: load({}) });
    rerender({ source: load({}) });
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('læser igen ved en ny indlæsning, men ikke når teksten bare skifter', () => {
    const { rerender } = renderHook(
      ({ source, message }: { source: LoadSource; message: string }) => useAnnounceLoaded(source, message),
      { initialProps: { source: load({ isLoading: true }), message: 'Indhold indlæst' } },
    );
    rerender({ source: load({}), message: 'Projekter indlæst' });
    // Skift af besked mens indholdet står klar siger intet — kun en ny
    // indlæsning læses, og den læser den tekst der er aktuel da.
    rerender({ source: load({}), message: 'Budget indlæst' });
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Projekter indlæst');
    rerender({ source: load({ isLoading: true }), message: 'Budget indlæst' });
    rerender({ source: load({}), message: 'Budget indlæst' });
    expect(spoken).toHaveBeenCalledTimes(2);
    expect(spoken).toHaveBeenLastCalledWith('Budget indlæst');
  });
});

describe('screenLoad', () => {
  function load(props: Partial<LoadSource>) {
    return { isLoading: false, isError: false, ...props };
  }

  it('er færdig, når den sidste region er færdig — ikke ved den første', () => {
    const sources = [load({ isLoading: true }), load({ isLoading: true })];
    expect(screenLoad(...sources).isLoading).toBe(true);
    sources[1] = load({});
    expect(screenLoad(...sources).isLoading).toBe(true);
    sources[0] = load({});
    expect(screenLoad(...sources).isLoading).toBe(false);
  });

  it('tæller en fejl kun, når ingen af regionerne leverede', () => {
    expect(screenLoad(load({ isError: true }), load({})).isError).toBe(false);
    expect(screenLoad(load({ isError: true }), load({ isError: true })).isError).toBe(true);
  });

  it('regner et slået-fra kald som færdigt, så et gated hjørne ikke forsinker skærmen', () => {
    // React Query sætter isLoading = isPending && isFetching, så `enabled: false`
    // giver false. Her verificeres bare at hjælpen ikke selv laver om ved det.
    const gated = load({});
    const real = load({ isLoading: true });
    expect(screenLoad(real, gated).isLoading).toBe(true);
    expect(screenLoad(real, gated).isError).toBe(false);
  });

  it('gør en skærm med tre regioner til ét stop, ikke tre', () => {
    const { rerender } = renderHook(
      ({ regions }: { regions: LoadSource[] }) => useAnnounceLoaded(screenLoad(...regions), 'Indhold indlæst'),
      { initialProps: { regions: [load({ isLoading: true }), load({ isLoading: true }), load({ isLoading: true })] } },
    );
    rerender({ regions: [load({}), load({}), load({})] });
    expect(spoken).toHaveBeenCalledTimes(1);
  });
});

/**
 * Forudsætningen bag `screenLoad`: en region der fejler har sin egen
 * `ErrorState`, så skærmens sluttilstand er ærlig. Uden den bliver
 * "Indhold indlæst" lyst løgn, fordi den fejlede region viser sin *gamle*
 * tilstand: nuller i stedet for timer, "Ingen registrerede tider" i stedet
 * for en fejl, eller en kontrol der bare forsvinder.
 *
 * De fire `screenLoad`-tests ovenfor kan ikke fange det — de tester hjælpen
 * alene, uden en skærm, så porten var grøn fordi den ikke kiggede. Denne
 * port læser derimod kaldsites og kræver, at hvert kald skærmen folder ind
 * faktisk undersøger sin egen `isError`.
 *
 * Grænsen er bevidst: porten ser, at regionen *læses*, ikke at handlingen er
 * rigtig. Den fanger den klasse fejl, der her er sket — et kald der aldrig
 * blev set efter — og intet mere.
 */
describe('hver region i et screenLoad-stop skal kunne vise sin egen fejl', () => {
  function regionsOf(source: string): string[] {
    const call = /screenLoad\(([^)]*)\)/.exec(source);
    if (!call)
      return [];
    return call[1].split(',').map(arg => arg.trim()).filter(arg => /^[a-z]\w*$/i.test(arg));
  }

  it('læser .isError for hvert kald, der foldes ind i stopket', () => {
    const files = sourceFiles(SRC_ROOT)
      .filter(file => !/\.test\.tsx?$/.test(file))
      .map(file => ({ file, source: readFileSync(file, 'utf-8') }))
      .filter(({ source }) => /screenLoad\(/.test(source));

    // Kun de 6 filer der bruger `screenLoad` er portens genstand. Uden
    // tærsklen ville et omdøbt `screenLoad` give 0 filer og 0 fund — grøn.
    forventDækning(files.map(f => f.file), 4);

    // Uden den her fejede `client-detail` sin `stats` og `recent` med, og
    // skærmen viste 0,0 t og 0,00 kr. for en kunde den ikke kendte.
    const unhandled = files.flatMap(({ file, source }) => {
      const regions = regionsOf(source);
      return regions
        .filter(region => !new RegExp(`\\b${region}\\.isError\\b`).test(source))
        .map(region => `${file.replace(SRC_ROOT, 'src')}: ${region}`);
    });

    expect(unhandled).toEqual([]);
  });
});

/**
 * Huskeregel for opgave 6.9: en skærm der viser en pladsholder skal sige, hvornår
 * indholdet er der. 6.9 satte `useAnnounceLoaded` på en håndplukket liste, så
 * de skærme der ikke var på listen fik det ikke — præcis den fejlform de
 * foregående fund havde: en regel der dømmer de steder den kendte. Kunde- og
 * projektformularen lå her og viste en skeleton, før felterne kom uden et ord,
 * mens 30 andre skærme sagde "Indhold indlæst".
 *
 * Denne port læser alle `*-screen.tsx` i stedet for en liste, så den nye
 * skærm er dømt med det samme.
 *
 * Grænsen er bevidst, og den er smallere end opgave 6.9's: kun det der
 * VENTER. Noget uden pladsholder har ikke lovet nogen noget, så intet skal
 * læses; og `useMutation` indlæser ikke indhold, så det dømmes ikke. Det er
 * derfor `new-entry-screen` (kun mutationer) og `more-screen` (ingen
 * lade-indikator) ikke gør.
 *
 * Siden opgave 6.13 dømmer porten **komponenter** med, ikke kun skærme: de otte
 * kort og ark under skærmene hentede selv og viste en skeleton, så en
 * skærmlæser hørte skærmens titel og så to-tre kort materialisere sig i
 * lydløshed — de talte ikke, fordi porten kun kendte `-screen.tsx`.
 */
describe('noget der venter på indhold skal sige det højt', () => {
  it('kalder useReportLoad på hver skærm OG komponent med et kald og en pladsholder', () => {
    const medPladsholder = sourceFiles(SRC_ROOT)
      .filter(file => !/\.test\.tsx?$/.test(file))
      .map(file => ({ file, source: readFileSync(file, 'utf-8') }))
      .filter(({ source }) => /trpc\.\w+\.\w+\.useQuery\(/.test(source) && /(Skeleton|ActivityIndicator)/.test(source));

    // De 43 filer der henter NOGET og viser en pladsholder er portens
    // genstand — ikke de 6 der efterlader, for de er fundet.
    forventDækning(medPladsholder.map(f => f.file), 20);

    const silent = medPladsholder
      .filter(({ source }) => !/useReportLoad|useAnnounceLoaded|useAnnounceVisible|screenLoad|ScreenLoad/.test(source))
      .map(({ file }) => file.replace(SRC_ROOT, 'src'));

    expect(silent).toEqual([]);
  });
});

/**
 * Samme forudsætning for de *meldte* kald: `useReportLoad` får et kald
 * videre til skærmens stop, og `screenLoad` regner en fejl som værende sket
 * kun når alle regioner fejler — altså forventer den, at hvert meldt kald
 * selv kan vise sin egen fejl. `from-time-sheet` meldte `clients.list` uden
 * nogen fejlvisning, så et netværksproblem endte som en Select uden
 * kunder; `project-rates` viste "prisen er ikke ændret" for et kald der
 * aldrig kom.
 *
 * Afgrænsningen er bevidst: porten ser, at `.isError` *læses* — ikke at
 * den anvendes rigtigt. Den fanger den klasse fejl, der er sket her, et kald
 * der aldrig blev set efter, og intet mere.
 */
describe('hvert meldt kald skal kunne vise sin egen fejl', () => {
  function reportedCalls(source: string): string[] {
    return Array.from(source.matchAll(/useReportLoad\(\s*([a-z]\w*)\s*[,)]/g), match => match[1]);
  }

  it('læser .isError for hvert kald der meldes til et stop', () => {
    const meldte = sourceFiles(SRC_ROOT)
      .filter(file => !/\.test\.tsx?$/.test(file))
      .map(file => ({ file, source: readFileSync(file, 'utf-8') }))
      .filter(({ source }) => /useReportLoad\(/.test(source));

    // De filer der melder et kald til et stop er portens genstand. Tærsklen
    // fanger det værste: at `useReportLoad` er omdøbt, så porten så 0 filer.
    forventDækning(meldte.map(f => f.file), 10);

    const unchecked = meldte
      .flatMap(({ file, source }) => reportedCalls(source)
        .filter(call => !new RegExp(`\\b${call}\\.isError\\b`).test(source))
        .map(call => `${file.replace(SRC_ROOT, 'src')}: ${call}`));

    expect(unchecked).toEqual([]);
  });
});

/**
 * Dækningspåstand for portene i denne fil — samme læring som fund F2.
 *
 * Alle fem læser kilden frem for at renderer den, så kæden
 * `sourceFiles(src) === [] ⇒ fund === [] ⇒ grøn` kan gøre en forkert rod
 * grøn frem for rød. En port skal derfor dømme *sin egen* udvalgte mængde,
 * ikke blot at globen gav filer: ellers er påstanden sand for alle fem, selv
 * hvis den ene ports mønster holdt op med at matche (fx hvis `screenLoad`
 * blev omdøbt).
 */
function forventDækning(udvalgt: string[], mindst: number): void {
  // Uden tærsklen er `udvalgt` tom, portens fund tom, og porten grøn — altså
  // præcis den fejlform F2 handlede om.
  expect(udvalgt.length).toBeGreaterThanOrEqual(mindst);
}

describe('kildefilernes rækkevidde', () => {
  it('finder kilder at kontrollere', () => {
    const kilder = sourceFiles(SRC_ROOT);
    expect(kilder.length).toBeGreaterThan(200);
    expect(kilder.filter(f => f.endsWith('-screen.tsx')).length).toBeGreaterThan(40);
    expect(kilder.some(f => f.endsWith(join('components', 'ui', 'button.tsx')))).toBe(true);
  });
});

/** `announce`/`announce-load` er mekanismen selv — de taler ikke for nogen skærm. */
function isMechanism(file: string): boolean {
  return /(^|\/)lib\/notify(-load)?\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file);
}

/** Alle kilder under `src/` som sti-relativ tekst, så en port kan følge imports. */
function sourceMap(): Map<string, string> {
  return new Map(sourceFiles(SRC_ROOT).map(file => [file.slice(SRC_ROOT.length + 1), readFileSync(file, 'utf-8')]));
}

function resolveImport(specifier: string, from: string, all: Map<string, string>): string | null {
  if (specifier.startsWith('@/'))
    return null;
  const base = specifier.startsWith('~/') ? specifier.slice(2) : join(dirname(from), specifier);
  return [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]
    .find(candidate => all.has(candidate)) ?? null;
}

/** Alle filer der kan nås fra `from` — skærmens træ. */
function screenTree(from: string, all: Map<string, string>): string[] {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || isMechanism(file))
      continue;
    const source = all.get(file);
    if (!source)
      continue;
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const target = resolveImport(match[1] ?? '', file, all);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen];
}

/** Fra `(` til den afsluttende `)`. */
function callBody(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(')
      depth++;
    else if (source[i] === ')' && --depth === 0)
      return source.slice(open, i + 1);
  }
  return source.slice(open);
}

/** Fra en `<ScreenLoad` til taggen lukker. */
function tagBody(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === '{' || char === '(' || char === '[')
      depth++;
    else if (char === '}' || char === ')' || char === ']')
      depth--;
    else if (char === '>' && depth === 0)
      return source.slice(open, i + 1);
  }
  return source.slice(open);
}

function keysIn(text: string): string[] {
  return Array.from(text.matchAll(/translate\(\s*'([^']+)'\s*\)/g), match => match[1] ?? '').filter(Boolean);
}

function at(match: RegExpMatchArray): number {
  return match.index ?? 0;
}

function stopsIn(source: string): { own: string[]; reported: string[]; collected: string[] } {
  const own: string[] = [];
  const reported: string[] = [];
  const collected: string[] = [];
  for (const match of source.matchAll(/useAnnounceLoaded\(/g))
    own.push(...keysIn(callBody(source, at(match) + match[0].length - 1)));
  for (const match of source.matchAll(/useReportLoad\(/g))
    reported.push(...keysIn(callBody(source, at(match) + match[0].length - 1)));
  for (const match of source.matchAll(/<ScreenLoad\b/g))
    collected.push(...keysIn(tagBody(source, at(match) + match[0].length)));
  return { collected, own, reported };
}

/**
 * ÉN tale pr. besked i et skærm-træ — fundet af review 30/9 21:35.
 *
 * `ProjectList` talte selv (`useAnnounceLoaded`) under to skærme der *også*
 * talte, så en blind bruger hørte "Indhold indlæst" to gange — og på
 * kundedetaljerne den første mens fire andre regioner stadig summede. Der er
 * ingen afskærmning: `announce` kalder `announceForAccessibility` uden dedupe,
 * og testen ovenfor dømmer udtrykkeligt at to ens beskeder i træk begge læses.
 *
 * De andre porte dømmer *tilstedeværelse* af en regel (kalder den
 * `useReportLoad`? læser den `.isError`?), aldrig at der kun er ÉN stemme pr.
 * skærm — derfor var de grønne, mens denne fejl stod i to skærme. Porten her
 * følger importene fra hver `*-screen.tsx` og tæller de stop, der faktisk
 * kan lyde i samme træ:
 *
 *  - `useAnnounceLoaded` i skærmen eller et barn — altid en stemme
 *  - `<ScreenLoad>` — en stemme, og den *sluger* alle `useReportLoad` under sig
 *  - `useReportLoad` uden en `ScreenLoad` over sig — også en stemme, fordi
 *    `useReportLoad` taler selv, når ingen har samlet regionerne
 *
 * To regioner med hver sin besked er derimod tilladt og brugt bevidst
 * (`flex-screen`: "Hold indlæst" / "Poster indlæst") — det er kun den *samme*
 * besked to gange, der er en fejl, fordi brugeren så hører "Indhold indlæst"
 * mens en skeleton stadig summerer.
 *
 * Grænser, bevidste: rækkevidden følger imports, ikke JSX, så en komponent der
 * importeres men ikke renderer tælles med (overtil — den fanger aldrig en
 * dobbelt tale, den kan skjule én); en `ScreenLoad i et søskend-træ` regnes
 * som om den lå overalt i træet (samme grund); et ark (`Modal`) er sin egen
 * overflade og tælles ikke med i skærmen bag det; og mekanismens egne filer
 * er lukket ude, de taler ikke for nogen skærm.
 */
describe('en besked må kun læses fra ét stop i et skærm-træ', () => {
  it('finder ingen skærm der læser den samme besked to gange', () => {
    const all = sourceMap();
    const screens = [...all.keys()].filter(file => /-screen\.tsx$/.test(file));

    // Hele portens genstand er skærmene — 63 i dag. Uden tærsklen ville et
    // omdøft skærm-mønster give 0 skærme, altså ingen dobbelt tale at finde.
    forventDækning(screens, 40);

    const doubles = screens.flatMap((screen) => {
      const files = screenTree(screen, all);
      // Ét `ScreenLoad` i træet samler alle `useReportLoad` under sig — også
      // i et søskend-undertræ, hvilket er en overtiltale (se grænserne).
      const collected = files.some(file => stopsIn(all.get(file) ?? '').collected.length > 0);
      const spoken = files.flatMap((file) => {
        // Et ark er sin egen overflade: komponenten der renderer et `Modal`
        // taler for arket, ikke for skærmen bag det. Uden undtagelsen ville
        // porten tælle `project-picker-modal` med i hver skærm der *kan*
        // vise den. Undtagelsen gælder kun forskærmen — arket dømmes stadig
        // for sine egne beskeder nedenfor.
        //
        // (6.24 målte, om et lukket ark overhovedet KAN tale: `BottomSheetModal`
        // renderer `mount ? <Portal>…</Portal> : null`, og `mount` bliver først
        // sand i `handlePresent`. Børnene er altså ikke monteret, mens arket er
        // lukket — den fejlform fandt nul steder. Det var et andet problem i
        // samme fil, som rettelsen så gik efter.)
        const source = all.get(file) ?? '';
        if (!/-screen\.tsx$/.test(file) && /<Modal\b|<BottomSheetModal\b/.test(source))
          return [];
        const stops = stopsIn(source);
        return collected ? [...stops.own, ...stops.collected] : [...stops.own, ...stops.reported];
      });
      const counts = spoken.reduce<Record<string, number>>((tally, key) => ({ ...tally, [key]: (tally[key] ?? 0) + 1 }), {});
      return Object.entries(counts)
        .filter(([, count]) => count > 1)
        .map(([key, count]) => `${screen}: '${key}' \u00D7 ${count}`);
    });

    expect(doubles).toEqual([]);
  });
});
