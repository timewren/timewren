import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Hvert formularfelt skal have et navn, en skærmlæser kan læse højt.
 *
 * Målt 1/10 med TypeScript-AST'en over de 87 `.tsx` i `src/`: **11 rå
 * `<input>`/`<select>`/`<textarea>`** uden `aria-label`, `aria-labelledby`, en
 * omsluttende `<label>` eller et `id` der peger på en `<label htmlFor>` —
 * `EntrySelector` (4), `InvoiceEditor` (4), `OnboardingWizard` (1),
 * `ReportView` (2) — plus **15 `<Input>`** uden `label`-prop, deribland
 * licensnøgle-felterne i to filer, og **2 ikonknapper** hvis eneste indhold er
 * et `lucide`-ikon (`InvoiceEditor`: tilbage og slet linje).
 *
 * Et felt uden navn er ikke en mangel en skærmlæser siger fra: den siger
 * «redigerbar», og brugeren ved ikke hvad der skal skrives. For et
 * klippekort-program er det forskellen på «antal» og «enhedspris».
 *
 * Porten dømmer **JSX'en, ikke den renderede DOM**. Det er bevidst: den skal
 * finde felterne i de filer der endnu ikke har en test, og en renderet port
 * kan kun dømme den komponent den mount'er. Til gengæld skal den selv bevises:
 * `finder et felt uden navn i en syntetisk fil` dømmer scanneren, så en port
 * der holder op med at finde noget bliver rød i stedet for grøn.
 */

/** Felter der skal have et navn — de rå elementer. */
const FELTER = new Set(["input", "select", "textarea"]);

/** Vores egen feltkomponent: `label`-prop'en giver navnet, ellers ikke. */
const INPUT_KOMPONENT = "Input";

/**
 * `cmdk`s egen søgefelt får sit navn andetsteds: `Command.Dialog`s `label`
 * renderes som en skjult `<label>`, og `Command.Input` peger på den med
 * `aria-labelledby` — målt i jsdom 1/10 med `computeAccessibleName`: uden
 * `label` på roden er det beregnede navn **tom streng**, og `aria-label` på
 * inputtet *overstyres* af `aria-labelledby`. Så et `aria-label` dér er død
 * kode, der ligner en rettelse.
 *
 * Derfor dømmer porten roden i stedet for feltet: `Command.Input` er dækket,
 * når den er inde i en `Command`/`Command.Dialog` med `label`. Det er fundet
 * ved at skrive `aria-label` på inputtet, se at intet ændrede sig, og således
 * finde årsagen.
 */
const CMDK_INPUT = "Command.Input";

/** Knapper og links: kun et ikon = intet navn for en skærmlæser. */
const KNAPPER = new Set(["button", "a"]);

/** Gør en glob-sti til en sti fra repo-roden. */
function stier(relativ: string): string {
  const dele = "src/components/__tests__".split("/");
  for (const del of relativ.split("/")) {
    if (del === "." || del === "") continue;
    if (del === "..") dele.pop();
    else dele.push(del);
  }
  return dele.join("/");
}

/** Kilderne som rå tekst — porten læser koden, ikke den kørte app. */
const kilder: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  )
    .filter(([fil]) => !/(^|\/)(__tests__\/|[^/]+\.test\.tsx$)/.test(fil))
    .map(([fil, tekst]) => [stier(fil), tekst]),
);

const FILER = Object.keys(kilder);

/** `id="x"` og `htmlFor="x"` skal kunne sammenlignes, uanset om de er `{x}`. */
function råVærdi(tekst: string | undefined): string {
  return (tekst ?? "").replace(/^['"{]/, "").replace(/['"}]$/, "");
}

function attributter(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): Set<string> {
  const ud = new Set<string>();
  for (const p of node.attributes.properties) {
    if (ts.isJsxAttribute(p)) ud.add(p.name.getText(node.getSourceFile()));
  }
  return ud;
}

/** Er elementet inde i en `<label>`? Så har feltet navn uden at spørge. */
function iLabel(node: ts.Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (
      ts.isJsxElement(cur) &&
      cur.openingElement.tagName.getText(cur.getSourceFile()) === "label"
    ) {
      return true;
    }
  }
  return false;
}

/** Elementets egen tekst, tags og udtryk skrællet af. */
function tekstUdenTags(node: ts.JsxElement): string {
  return node.children
    .map((c) => (ts.isJsxText(c) ? c.text : c.getText(node.getSourceFile())))
    .join(" ")
    .replace(/<[^>]*>/g, "");
}

interface Fund {
  fil: string;
  linje: number;
  hvad: string;
}

/**
 * Ét fund for hvert felt eller knap uden navn.
 *
 * Samme signatur som de andre porte i denne mappe: `fil:linje` og en
 * beskrivelse, så en fejl peger på den linje der skal rettes.
 */
function findUdenNavn(fil: string, kilde: string): Fund[] {
  const sf = ts.createSourceFile(
    fil,
    kilde,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // Alle `htmlFor` i filen — et `id` der matcher en, har en etiket.
  const htmlFor = new Set<string>();
  const samlHtmlFor = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === "htmlFor") {
      htmlFor.add(råVærdi(n.initializer?.getText(sf)));
    }
    n.forEachChild(samlHtmlFor);
  };
  samlHtmlFor(sf);

  /**
   * Ligger `Command.Input` inde i en `<Command … label>` eller
   * `<Command.Dialog … label>`? Så har den et navn — se `CMDK_INPUT` for hvorfor
   * det er roden, ikke feltet, der skal dømmes.
   */
  function cmdkRodHarLabel(node: ts.Node, sf: ts.SourceFile): boolean {
    for (let cur = node.parent; cur; cur = cur.parent) {
      if (!ts.isJsxElement(cur)) continue;
      const tag = cur.openingElement.tagName.getText(sf);
      if (tag !== "Command" && tag !== "Command.Dialog") continue;
      const harLabel = cur.openingElement.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "label",
      );
      if (harLabel) return true;
    }
    return false;
  }

  const fund: Fund[] = [];
  const meld = (node: ts.Node, hvad: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    fund.push({ fil, linje: line + 1, hvad });
  };

  const gennemgaa = (node: ts.Node) => {
    const selve = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (selve) {
      const tag = selve.tagName.getText(sf);
      const ren = tag.includes(".") ? (tag.split(".").pop() ?? "") : tag;
      const opening = selve;
      const attrs = attributter(opening);
      const aria = attrs.has("aria-label") || attrs.has("aria-labelledby");

      if (FELTER.has(ren)) {
        // `id="x"` + en `<label htmlFor="x">` i samme fil = feltet har navn.
        const egetId = råVærdi(
          opening.attributes.properties
            .filter(
              (p): p is ts.JsxAttribute =>
                ts.isJsxAttribute(p) && p.name.getText(sf) === "id",
            )
            .map((p) => p.initializer?.getText(sf))[0],
        );
        if (!aria && !htmlFor.has(egetId) && !iLabel(node)) {
          meld(node, `<${ren}> uden navn`);
        }
      } else if (ren === INPUT_KOMPONENT) {
        if (tag === CMDK_INPUT) {
          if (!cmdkRodHarLabel(node, sf))
            meld(node, "<Command.Input> uden navngivet rod");
        } else if (!aria && !attrs.has("label")) {
          meld(node, "<Input> uden label");
        }
      } else if (KNAPPER.has(ren)) {
        if (aria || attrs.has("title")) {
          // Navngivet — spring resten af knappen over.
        } else if (ts.isJsxElement(node)) {
          const synlig = tekstUdenTags(node);
          if (!/[a-zA-ZæøåÆØÅ0-9]/.test(synlig)) {
            meld(node, `<${ren}> med kun et ikon`);
          }
        }
      }
    }
    node.forEachChild(gennemgaa);
  };
  gennemgaa(sf);
  return fund;
}

const fundene = FILER.flatMap((fil) => findUdenNavn(fil, kilder[fil]));

describe("formularfelter har et navn", () => {
  it("intet felt eller knap står uden navn", () => {
    expect(
      fundene.map((f) => `${f.fil}:${f.linje} — ${f.hvad}`),
      `Disse skal have et navn, en skærmlæser kan læse højt:\n${fundene
        .map((f) => `${f.fil}:${f.linje} — ${f.hvad}`)
        .join(
          "\n",
        )}\n\nBrug aria-label={t("...")} på feltet, eller <label htmlFor> på en\n<label> der omslutter det.`,
    ).toEqual([]);
  });

  it("porten ser de filer den skal se", () => {
    // Uden dette er en glob der ikke matcher rød på samme måde som den
    // korrekte kode — målt 1/10 på `RegistreretTidPort`. Tallet er **87**
    // (`.tsx` under `src/`, tests og `__tests__` holdt ude), målt 1/10.
    expect(FILER.length).toBeGreaterThan(80);
  });

  it("porten kan overhovedet finde et felt uden navn", () => {
    // Beviser scanneren. Uden denne test er «ingen fund» ubevis: en port der
    // holder op med at parse JSX ville være grøn og døde.
    const syntetisk = `
      export function Eksempel() {
        return (
          <div>
            <input type="text" value={a} onChange={b} />
            <select value={a} onChange={b} />
            <textarea value={a} onChange={b} />
            <Input value={a} onChange={b} />
            <button type="button" onClick={c}><Trash2 size={12} /></button>
            <Command.Input placeholder="Søg" />
            <Command label="Kommando">
              <Command.Input placeholder="Søg" />
            </Command>
            <input type="text" aria-label="Har navn" />
            <label htmlFor="felt">Med etiket</label>
            <input type="text" id="felt" />
            <Input label="Med label" />
            <button type="button" onClick={c}>Slet</button>
          </div>
        );
      }
    `;
    const fund = findUdenNavn(" Eksempel.tsx", syntetisk);
    // `Command.Input` uden `label` på roden er med vilje: den får sit navn
    // fra `Command`'s `label`, ikke fra sig selv (se `CMDK_INPUT`), så den skal
    // findes når roden mangler — og den anden må *ikke* findes.
    expect(fund.map((f) => f.hvad)).toEqual([
      "<input> uden navn",
      "<select> uden navn",
      "<textarea> uden navn",
      "<Input> uden label",
      "<button> med kun et ikon",
      "<Command.Input> uden navngivet rod",
    ]);
  });
});
