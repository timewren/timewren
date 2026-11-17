import { describe, expect, it } from "vitest";
import { clientPathTo, reaches } from "@/test/import-graph";
import { STATIC_NAMESPACES, STATIC_RAW } from "../messages/static";

// Hjælpere, som også kører i browseren. Importerer de hele det statiske
// katalog (alle sprog af mails, notifikationer osv.), havner det i det
// fælles klientbundt på hver side.
const BROWSER_HELPERS = [
  "i18n/sync-text.ts",
  "i18n/shared-text.ts",
  "components/pdf/pdf-text.ts",
];

describe("statisk katalog i klientbundtet", () => {
  it("vagten kan se, at staticMessages trækker hele kataloget med", () => {
    expect(reaches("i18n/static-catalog.ts", "i18n/messages/static.ts")).toBe(
      true,
    );
  });

  it.each(BROWSER_HELPERS)("%s importerer ikke hele STATIC_RAW", (helper) => {
    expect(reaches(helper, "i18n/messages/static.ts")).toBe(false);
  });

  it("ingen klientkomponent når hele STATIC_RAW", () => {
    expect(clientPathTo("i18n/messages/static.ts")).toBeNull();
  });

  it("navneområdemodulerne indeholder det samme som STATIC_RAW", async () => {
    for (const ns of STATIC_NAMESPACES) {
      const mod = await import(`../catalogs/${ns}.ts`);
      expect(mod.default).toBe(STATIC_RAW[ns]);
    }
  });
});
