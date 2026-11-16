import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_DARK, BRAND_LIGHT } from "./tokens";

const root = resolve(__dirname, "../../..");
const json = JSON.parse(
  readFileSync(resolve(root, "docs/brand/tokens.json"), "utf8"),
);
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");

const cssName = (key: string) =>
  `--tt-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function cssBlock(selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("brand-tokens", () => {
  it("TS-konstanterne matcher docs/brand/tokens.json", () => {
    expect(BRAND_LIGHT).toEqual(json.color.light);
    expect(BRAND_DARK).toEqual(json.color.dark);
  });

  it("globals.css har samme lyse og mørke værdier", () => {
    const light = cssBlock(":root {");
    const dark = cssBlock(":root.dark {");
    const media = cssBlock(":root:not(.light):not(.dark) {");
    const forcedLight = cssBlock(".tt-lys {");
    for (const [key, value] of Object.entries(BRAND_LIGHT)) {
      expect(forcedLight).toContain(`${cssName(key)}: ${value.toLowerCase()};`);
      expect(light).toContain(`${cssName(key)}: ${value.toLowerCase()};`);
    }
    for (const [key, value] of Object.entries(BRAND_DARK)) {
      expect(dark).toContain(`${cssName(key)}: ${value.toLowerCase()};`);
      expect(media).toContain(`${cssName(key)}: ${value.toLowerCase()};`);
    }
  });

  it("brand-skalaen i CSS matcher JSON, og 600 er granskov", () => {
    expect(json.color.brandScale["600"]).toBe("#1E5B47");
    for (const [step, value] of Object.entries(
      json.color.brandScale as Record<string, string>,
    )) {
      expect(css).toContain(`--color-brand-${step}: ${value.toLowerCase()};`);
    }
  });
});
