import { describe, expect, it } from "vitest";

/**
 * Der skal være én fejltilstand for en fejlet indlæsning, ikke en pr. komponent.
 *
 * Mønsteret `catch (err) { console.error(...) } finally { setLoading(false) }`
 * lå i ti komponenter, fordi ingen af dem havde en fælles del at låne fra. Den
 * næste der kommer med samme fejl ville skrive den igen, og det er præcis
 * derfor de alle viste *tom-tilstanden* i stedet: hver af dem troede, at en
 * fejlet hentning betød «der er ingen data».
 *
 * Kilderne læses med `import.meta.glob` — samme greb som `i18n.test.ts` bruger
 * til sine egne porte — så testen ikke trænger på Node's `fs`, som
 * `tsconfig.json` bevidst ikke erklærer.
 */
/**
 * Gør en glob-sti til en sti fra repo-roden.
 *
 * `import.meta.glob` giver stier *relativt til denne fil* (`../ui/Button.tsx`),
 * og de kan pege opad med `../` i vilkårligt mange niveau — så de skal løses,
 * ikke blot have et fast præfiks sat foran. `i18n.test.ts` ligger dybere i
 * træet og kan nøjes med sit `replace`, fordi dens glob rækker højere op.
 */
function stier(relativ: string): string {
  const dele = "src/components/__tests__".split("/");
  for (const del of relativ.split("/")) {
    if (del === "." || del === "") continue;
    if (del === "..") dele.pop();
    else dele.push(del);
  }
  return dele.join("/");
}

const kilder = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  )
    .filter(([fil]) => !/(^|\/)(__tests__\/|[^/]+\.test\.[tj]sx?$)/.test(fil))
    .map(([fil, tekst]) => [stier(fil), tekst]),
);

const FILER = Object.keys(kilder);

/** Komponenter der indlæser med `tauriInvoke` og derfor kan fejle ved indlæsning. */
function indlæser(fil: string): boolean {
  const s = kilder[fil];
  return /tauriInvoke/.test(s) && /setLoading/.test(s);
}

/** Sætter komponenten nogensinde en synlig fejltilstand? */
function harFejltilstand(s: string): boolean {
  return (
    /setLoadFailed|setFailed|set[A-Za-z]*LoadFailed/.test(s) ||
    /<LoadError/.test(s)
  );
}

/** Har denne `catch`-blok en fejl, brugeren aldrig ser? */
function erStilleCatch(blok: string): boolean {
  return (
    /console\.(error|warn|log)/.test(blok) &&
    !/toast\.|LoadError|set[A-Za-z]*Failed|set[A-Za-z]*Error/.test(blok)
  );
}

function stilleCatches(s: string): string[] {
  return [...s.matchAll(/catch\s*\(\s*\w*\s*\)\s*\{([^}]*)\}/g)]
    .map((m) => m[1])
    .filter(erStilleCatch);
}

/**
 * En komponent uden fejltilstand overhovedet, som fanger en fejl stille.
 *
 * Bevidst på komponent-niveau og ikke pr. `catch`: to komponenter har en
 * *pynt*-hentning i sin egen try — projekternes navne til aktivitetsfeedet og
 * budgetmærketingen i projektlisten — hvor en fejl kun skal skjule pynten, ikke
 * tage indholdet med ned. Begge har samtidig en rigtig fejltilstand for deres
 * eget indhold, så de er ikke fund. Porten kan ikke se forskel på dem ved at
 * læse én `catch` ad gangen, og den skal ikke gætte: den dømmer altså om
 * komponenten overhovedet nogensinde sætter en fejltilstand.
 */
function stilleUdenFejltilstand(fil: string): boolean {
  const s = kilder[fil];
  return stilleCatches(s).length > 0 && !harFejltilstand(s);
}

const fejlende = FILER.filter(
  (f) => f.endsWith(".tsx") && indlæser(f) && stilleUdenFejltilstand(f),
);

describe("indlæsningsfejl har én fælles tilstand", () => {
  it("ingen komponent fanger en indlæsningsfejl stilt", () => {
    // Beviset på hele klassen: enhver komponent der gør det, ville vist den
    // tomme tilstand (eller slet intet) i stedet for en fejl.
    expect(
      fejlende,
      `Disse fanger en indlæsningsfejl uden at vise den:\n${fejlende.join("\n")}\n\nBrug <LoadError message={...} onRetry={...} /> fra "@/components/ui/LoadError".`,
    ).toEqual([]);
  });

  it("porten ser de komponenter den skal se", () => {
    // Uden dette ville porten være grøn ved at slå alt fra: en `glob` der
    // ingen filer fandt, eller et mønster der aldrig matcher, ser præcis
    // lige så rød ud som den korrekte kode. Tallene er målt 1/10 med de samme
    // mønstre som porten bruger, og ligger under de rigtige — en ny komponent
    // må ikke gøre porten rød ved at optage plads.
    expect(FILER.length).toBeGreaterThan(100);
    const indlæsende = FILER.filter((f) => f.endsWith(".tsx") && indlæser(f));
    // Målt: 18.
    expect(indlæsende.length).toBeGreaterThan(15);
    // Og den skal kunne finde en stille `catch`, ellers dømmer den intet.
    // Målt: 5 — de to pynt-kald i RecentActivity og ProjectList plus tre
    // gemte skrivefejl i `lib/`.
    expect(
      FILER.filter((f) => stilleCatches(kilder[f]).length > 0).length,
    ).toBeGreaterThan(3);
    // Bevis på at stierne er løst rigtigt: portens egen fil skal kunne findes.
    expect(kilder["src/components/ui/LoadError.tsx"]).toBeTypeOf("string");
  });

  it("LoadError læser sin prøv-igen-knap fra i18n", () => {
    // Porten skal ikke kunne finde en `LoadError`, der hårdkoder dansk — sådan
    // en ville se rigtig ud i dansk og forkert i de fire andre sprog.
    const s = kilder["src/components/ui/LoadError.tsx"];
    expect(s).toMatch(/t\("errors\.tryAgain"\)/);
    // `message` er en egenskab, ikke en nøgle: kaldet står i komponenten, så en
    // nøgle-streng her ville være den samme streng i alle otte komponenter.
    expect(s).toMatch(/message: string/);
    expect(s).toMatch(/role="alert"/);
  });
});
