import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { Errors } from "@/lib/trpc/errors";
import { LOCALES } from "../config";
import { localeFromHeaders, runWithLocale, st, tr } from "../server-text";
import { syncT } from "../sync-text";

describe("server-text", () => {
  it("er dansk uden forespørgselskontekst", async () => {
    expect(st("errors.clientNotFound")).toBe("Kunde ikke fundet");
    expect(await tr("serverErrors", "common.clientNotFound")).toBe(
      "Kunde ikke fundet",
    );
    expect(Errors.invoiceNotFound().message).toBe("Faktura ikke fundet");
  });

  it("følger kaldets sprog inde i runWithLocale", async () => {
    await runWithLocale("en", async () => {
      expect(st("errors.clientNotFound")).toBe("Client not found");
      expect(await tr("serverErrors", "common.clientNotFound")).toBe(
        "Client not found",
      );
      expect(Errors.invoiceNotFound().message).toBe("Invoice not found");
    });
    runWithLocale("de", () => {
      expect(st("errors.clientNotFound")).toBe("Kunde nicht gefunden");
    });
  });

  it("udfylder pladsholdere", () => {
    expect(syncT("errors.invalidValue", { field: "email" }, "es")).toBe(
      "Valor no válido para email",
    );
  });

  it("vælger sprog fra cookie før Accept-Language", () => {
    const withCookie = new Headers({
      cookie: "a=b; locale=de",
      "accept-language": "es-ES,es;q=0.9",
    });
    expect(localeFromHeaders(withCookie)).toBe("de");
    expect(
      localeFromHeaders(new Headers({ "accept-language": "es-ES,es;q=0.9" })),
    ).toBe("es");
    expect(localeFromHeaders(null)).toBe("da");
  });
});

describe("serverkataloger", () => {
  const dir = join(process.cwd(), "src/i18n/messages");
  const namespaces = readdirSync(join(dir, "da")).filter((f) =>
    /^server.*\.json$/.test(f),
  );

  it("har gyldig ICU-syntaks i hver besked i alle sprog med katalog (beta-sprog må være delvise)", () => {
    expect(namespaces.length).toBeGreaterThan(0);
    for (const lang of LOCALES) {
      for (const ns of namespaces) {
        if (!existsSync(join(dir, lang, ns))) {
          expect(["da", "en"], `${lang}/${ns} mangler`).not.toContain(lang);
          continue;
        }
        const catalog = JSON.parse(
          readFileSync(join(dir, lang, ns), "utf8"),
        ) as Record<string, unknown>;
        const walk = (obj: Record<string, unknown>, path: string) => {
          for (const [key, value] of Object.entries(obj)) {
            if (typeof value === "object" && value !== null) {
              walk(value as Record<string, unknown>, `${path}${key}.`);
              continue;
            }
            const text = String(value);
            const values: Record<string, number> = {};
            for (const m of text.matchAll(/\{(\w+)/g)) values[m[1]] = 2;
            expect(
              () => new IntlMessageFormat(text, lang).format(values),
              `${lang}/${ns} ${path}${key}`,
            ).not.toThrow();
          }
        };
        walk(catalog, "");
      }
    }
  });
});
