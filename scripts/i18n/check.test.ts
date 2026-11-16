import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/i18n/check.mjs");
const realCfg = join(process.cwd(), "scripts/i18n/catalogs.json");

let root: string;

function write(rel: string, data: unknown) {
  const file = join(root, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
  );
}

const CHROME: Record<string, string> = { "pt-BR": "pt_BR", "zh-Hans": "zh_CN" };

// Et oversættelsesjob lægger filer i alle tre træer; her nok til, at --lang ikke klager over mapper.
function scaffold(lang: string) {
  write(`browser-extension/src/i18n/messages/${lang}/nav.json`, {});
  write(`browser-extension/_locales/${CHROME[lang] ?? lang}/messages.json`, {
    extName: { message: "X" },
  });
}

function run(...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [script, ...args], {
      env: { ...process.env, I18N_CHECK_ROOT: root },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
}

// Prøvekatalog: da og en komplette; pl, sv, ja og de.nogen delvise.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "i18n-check-"));
  mkdirSync(join(root, "scripts/i18n"), { recursive: true });
  cpSync(realCfg, join(root, "scripts/i18n/catalogs.json"));
  const da = {
    nav: { home: "Hjem", title: "Hej {name}" },
    list: { n: "{count, plural, one {# kunde} other {# kunder}}" },
  };
  const en = {
    nav: { home: "Home", title: "Hello {name}" },
    list: { n: "{count, plural, one {# client} other {# clients}}" },
  };
  for (const dir of [
    "src/i18n/messages",
    "browser-extension/src/i18n/messages",
  ]) {
    for (const l of ["da", "en"]) {
      const cat = l === "da" ? da : en;
      write(`${dir}/${l}/nav.json`, cat.nav);
      write(`${dir}/${l}/list.json`, cat.list);
    }
  }
  const chrome = { extName: { message: "X" } };
  for (const c of ["da", "en", "de", "es"])
    write(`browser-extension/_locales/${c}/messages.json`, chrome);
  for (const dir of [
    "src/i18n/messages",
    "browser-extension/src/i18n/messages",
  ]) {
    for (const l of ["de", "es"]) {
      write(`${dir}/${l}/nav.json`, { home: "x", title: "y {name}" });
      write(`${dir}/${l}/list.json`, {
        n: "{count, plural, one {# a} other {# b}}",
      });
    }
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("scripts/i18n/check.mjs", () => {
  it("accepterer delvise beta-sprog (manglende nøgler og navneområder)", () => {
    write("src/i18n/messages/sv/nav.json", { home: "Hem" });
    const r = run();
    expect(r.out).toContain("bestået");
    expect(r.code).toBe(0);
  });

  it("kræver stadig fuldstændige da og en", () => {
    rmSync(join(root, "src/i18n/messages/en/list.json"));
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("web/en: mangler nøgle list.n");
  });

  it("fejler på ukendt nøgle og ukendt navneområde", () => {
    scaffold("sv");
    write("src/i18n/messages/sv/nav.json", { home: "Hem", extra: "x" });
    write("src/i18n/messages/sv/other.json", { a: "b" });
    const r = run("--lang", "sv");
    expect(r.code).toBe(1);
    expect(r.out).toContain("ekstra nøgle nav.extra");
    expect(r.out).toContain("navneområdet findes ikke i da");
  });

  it("fejler på manglende og forkerte pladsholdere", () => {
    scaffold("sv");
    write("src/i18n/messages/sv/nav.json", { title: "Hej" });
    expect(run("--lang", "sv").out).toContain(
      "pladsholdere i nav.title afviger",
    );
    write("src/i18n/messages/sv/nav.json", { title: "Hej {navn}" });
    expect(run("--lang", "sv").code).toBe(1);
    write("src/i18n/messages/sv/nav.json", { title: "Hej {name}" });
    expect(run("--lang", "sv").code).toBe(0);
  });

  it("fejler på ugyldig JSON, tom tekst og tekst der ikke er en streng", () => {
    scaffold("sv");
    write("src/i18n/messages/sv/nav.json", "{ ikke json");
    expect(run("--lang", "sv").out).toContain("ugyldig JSON");
    write("src/i18n/messages/sv/nav.json", { home: "  " });
    expect(run("--lang", "sv").out).toContain("tom tekst i nav.home");
    write("src/i18n/messages/sv/nav.json", { home: 5 });
    expect(run("--lang", "sv").out).toContain("skal være tekst");
  });

  it("kræver sprogets flertalskategorier (pl: one/few/many/other)", () => {
    scaffold("pl");
    write("src/i18n/messages/pl/list.json", {
      n: "{count, plural, one {# klient} other {# klientów}}",
    });
    const bad = run("--lang", "pl");
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("mangler few, many");
    write("src/i18n/messages/pl/list.json", {
      n: "{count, plural, one {# klient} few {# klientów} many {# klientów} other {# klienta}}",
    });
    expect(run("--lang", "pl").code).toBe(0);
  });

  it("accepterer kun other i ja, men kræver one/other i sv", () => {
    scaffold("ja");
    scaffold("sv");
    write("src/i18n/messages/ja/list.json", {
      n: "{count, plural, other {#社}}",
    });
    expect(run("--lang", "ja").code).toBe(0);
    write("src/i18n/messages/sv/list.json", {
      n: "{count, plural, two {två kunder} other {# kunder}}",
    });
    const r = run("--lang", "sv");
    expect(r.code).toBe(1);
    expect(r.out).toContain("mangler one");
  });

  it("kræver ikke many i fransk (kun store tal), men =1 dækker one", () => {
    scaffold("fr");
    write("src/i18n/messages/fr/list.json", {
      n: "{count, plural, one {# client} other {# clients}}",
    });
    expect(run("--lang", "fr").code).toBe(0);
    write("src/i18n/messages/fr/list.json", {
      n: "{count, plural, =1 {un client} other {# clients}}",
    });
    expect(run("--lang", "fr").code).toBe(0);
  });

  it("--lang kræver, at sprogets mapper findes, og afviser ukendte sprog", () => {
    expect(run("--lang", "sv").out).toContain("mappen sv/ mangler");
    const r = run("--lang", "xx");
    expect(r.code).toBe(2);
    expect(r.out).toContain("Ukendt sprog");
  });

  it("--lang tjekker kun det valgte sprog", () => {
    scaffold("sv");
    scaffold("nb");
    write("src/i18n/messages/sv/nav.json", { home: "Hem", extra: "x" });
    write("src/i18n/messages/nb/nav.json", { home: "Hjem" });
    write("browser-extension/_locales/nb/messages.json", {
      extName: { message: "X" },
    });
    expect(run("--lang", "nb").code).toBe(0);
    expect(run("--lang", "sv").code).toBe(1);
  });

  it("kræver fuldstændig _locales-mappe og kender Chrome-koderne", () => {
    write("browser-extension/_locales/pt_BR/messages.json", {});
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("chrome-locales/pt_BR: mangler extName");
    rmSync(join(root, "browser-extension/_locales/pt_BR"), { recursive: true });
    write("browser-extension/_locales/pt-BR/messages.json", {
      extName: { message: "X" },
    });
    expect(run().out).toContain("er ikke Chrome-koden");
  });

  it("--report viser dækning pr. sprog", () => {
    write("src/i18n/messages/sv/nav.json", { home: "Hem" });
    const r = run("--report");
    expect(r.out).toMatch(/web\/sv: 1\/3 nøgler \(33\.3 %\)/);
    expect(r.out).toContain("web/ja: 0/3 nøgler (0.0 %)");
  });
});
