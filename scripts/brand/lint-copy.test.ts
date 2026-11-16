import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as lint from "./lint-copy.mjs";

type Fund = { regel: string; linje: number; tekst: string; antal: number };
const scan = (kilde: string, fil = "x.tsx"): Fund[] =>
  lint.scanKilde(kilde, fil);
const regler = (kilde: string, fil = "x.tsx") =>
  scan(kilde, fil).map((f) => f.regel);

describe("lint-copy: fanger plantede fejl", () => {
  it("tankestreg i JSX-tekst, attribut, streng og template", () => {
    expect(regler("const a = <p>Hej — dig</p>;")).toEqual(["tankestreg"]);
    expect(regler('const a = <img alt="Billede — stort" />;')).toEqual([
      "tankestreg",
    ]);
    expect(regler('toast.success("Gemt — godt");')).toEqual(["tankestreg"]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: kildekoden under test indeholder en template-streng
    expect(regler("const t = `Hej ${navn} — velkommen`;")).toEqual([
      "tankestreg",
    ]);
  });

  it("tankestreg som HTML-entitet og som kort streg med mellemrum", () => {
    expect(regler("const a = <p>Hej &mdash; dig</p>;")).toEqual(["tankestreg"]);
    expect(regler("const a = <p>Hej &#8212; dig</p>;")).toEqual(["tankestreg"]);
    expect(regler('const s = "Kunder – projekter";')).toEqual(["tankestreg"]);
    // Interval uden mellemrum er ikke en tankestreg.
    expect(regler('const s = "149–199 kr.";')).toEqual([]);
  });

  it("forbudte ord, også bøjet og over linjeskift", () => {
    expect(regler('const s = "En intuitiv app";')).toEqual(["forbudt-ord"]);
    expect(regler('const s = "Oplev forskellen";')).toEqual(["forbudt-ord"]);
    expect(regler('const s = "Helt problemfrit";')).toEqual(["forbudt-ord"]);
    expect(regler('const s = "AI-drevet planlægning";')).toEqual([
      "forbudt-ord",
    ]);
    expect(regler("const a = <p>Til dig i en travl\n hverdag</p>;")).toEqual([
      "forbudt-ord",
    ]);
    // "oplevelse" og "opdaget" er almindelige ord.
    expect(regler('const s = "En god oplevelse, fejl opdaget";')).toEqual([]);
  });

  it("klient som label og i sætning, CRM og kr/md", () => {
    expect(regler('const s = { label: "Klient" };')).toEqual(["klient"]);
    expect(regler("const a = <p>Opret en klient</p>;")).toEqual(["klient"]);
    expect(regler('const s = { title: "Klient-timer-oversigt" };')).toEqual([
      "klient",
    ]);
    expect(regler('const s = { name: "Klient-portal" };')).toEqual(["klient"]);
    expect(regler('const a = <input placeholder="Klientnavn..." />;')).toEqual([
      "klient",
    ]);
    expect(regler('const a = <input placeholder="klientnavn…" />;')).toEqual([
      "klient",
    ]);
    expect(regler('const s = "Et CRM til dig";')).toEqual(["crm"]);
    expect(regler('const s = "79 kr/md";')).toEqual(["kr-md"]);
    expect(regler('const s = "49 kr/bruger/md";')).toEqual(["kr-md"]);
    expect(regler('const s = "79 kr./md. ekskl. moms";')).toEqual([]);
  });

  it("tæller hver forekomst med rigtigt linjenummer", () => {
    const f = scan("const t = `linje et\nto — og — tre\nfire`;");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ regel: "tankestreg", linje: 2, antal: 2 });
  });
});

describe("lint-copy: ignorerer kode", () => {
  it("kommentarer, identifiers, className, import og typer", () => {
    const kilde = [
      'import { klient } from "@/lib/klient";',
      "// Klient — kommentar med tankestreg og CRM",
      "/* intuitiv blokkommentar */",
      'type Rolle = "klient" | "CRM";',
      "const klientId = 1;",
      'const a = <div className="klient — x" data-x="klient">{klientId}</div>;',
      'console.log("debug — klient");',
    ].join("\n");
    expect(scan(kilde)).toEqual([]);
  });

  it("enum-værdier og stier er ikke tekst", () => {
    expect(regler('if (rolle === "klient") {}')).toEqual([]);
    expect(regler('const href = "/klient-timer-oversigt";')).toEqual([]);
    expect(regler('const v = "klient";')).toEqual([]);
    expect(regler('const o = { "klient": 1 };')).toEqual([]);
  });
});

describe("lint-copy: undtagelser", () => {
  const fund = [
    { fil: "src/a.tsx", regel: "crm", tekst: "Kundeskab er et CRM", antal: 1 },
    { fil: "src/admin/b.tsx", regel: "tankestreg", tekst: "x — y", antal: 1 },
  ];

  it("fjerner ramte fund og melder ubrugte undtagelser", () => {
    const { tilbage, ubrugte } = lint.anvendUndtagelser(fund, [
      { fil: "src/a.tsx", regel: "crm", tekst: "er et CRM", grund: "x" },
      { fil: "src/gammel.tsx", regel: "crm", tekst: "CRM", grund: "x" },
    ]);
    expect(tilbage).toHaveLength(1);
    expect(ubrugte).toHaveLength(1);
  });

  it("mappe-undtagelse med stjerne rammer alt i mappen", () => {
    const { tilbage } = lint.anvendUndtagelser(fund, [
      { fil: "src/admin/", regel: "*", tekst: "*", grund: "x" },
    ]);
    expect(tilbage.map((f: { fil: string }) => f.fil)).toEqual(["src/a.tsx"]);
  });

  it("den rigtige undtagelsesfil er gyldig", () => {
    const { fejl } = lint.læsUndtagelser();
    expect(fejl).toEqual([]);
  });
});

describe("lint-copy: CLI", () => {
  const mappe = mkdtempSync(join(tmpdir(), "lint-copy-"));
  afterAll(() => rmSync(mappe, { recursive: true, force: true }));
  const script = resolve(__dirname, "lint-copy.mjs");

  it("fejler med exit 1 på en plantet fejl og 0 på ren tekst", () => {
    const dårlig = join(mappe, "daarlig.tsx");
    const god = join(mappe, "god.tsx");
    writeFileSync(
      dårlig,
      "export const A = () => <p>Opret en klient — nu</p>;\n",
    );
    writeFileSync(god, "export const A = () => <p>Opret en kunde nu</p>;\n");
    const r1 = spawnSync(process.execPath, [script, dårlig], {
      encoding: "utf8",
    });
    expect(r1.status).toBe(1);
    expect(r1.stdout).toContain("[tankestreg]");
    expect(r1.stdout).toContain("[klient]");
    const r2 = spawnSync(process.execPath, [script, god], { encoding: "utf8" });
    expect(r2.status).toBe(0);
  });
});
