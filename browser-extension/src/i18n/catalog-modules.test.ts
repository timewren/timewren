import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { modules as all } from "./catalog-modules";
import { modules as gmail } from "./catalog-modules.gmail";

const namespacesOf = (mods: Record<string, unknown>) =>
  new Set(Object.keys(mods).map((p) => p.replace(/^.*\/([^/]+)\.json$/, "$1")));

describe("Gmail-scriptets katalog (vite.config.ts bygger det for sig)", () => {
  it("har alle navneområder, gmail.ts slår op i", () => {
    const code = readFileSync(
      resolve(__dirname, "../content/gmail.ts"),
      "utf8",
    );
    const used = new Set(
      [...code.matchAll(/\bt\(\s*["'`]([A-Za-z]+)\./g)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    const have = namespacesOf(gmail);
    for (const ns of used) expect(have, ns).toContain(ns);
  });

  it("er et udsnit af det fulde katalog, i alle sprog", () => {
    for (const [path, mod] of Object.entries(gmail)) {
      expect(all[path], path).toBe(mod);
    }
    const locales = new Set(Object.keys(all).map((p) => p.split("/")[2]));
    for (const ns of namespacesOf(gmail)) {
      for (const l of locales) {
        if (all[`./messages/${l}/${ns}.json`]) {
          expect(gmail, `${l}/${ns}`).toHaveProperty(
            `./messages/${l}/${ns}.json`,
          );
        }
      }
    }
  });

  it("udelader resten (popup, ny fane, indstillinger …)", () => {
    expect(namespacesOf(gmail).size).toBeLessThan(namespacesOf(all).size);
  });
});
