import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERVER_ONLY_NAMESPACES,
  withoutServerNamespaces,
} from "./client-messages";

describe("withoutServerNamespaces", () => {
  it("fjerner serverens navneområder og beholder resten", () => {
    const out = withoutServerNamespaces({
      time: { a: "1" },
      serverErrors: { b: "2" },
      emailsAuth: { c: "3" },
    });
    expect(Object.keys(out)).toEqual(["time"]);
  });
});

describe("SERVER_ONLY_NAMESPACES", () => {
  it("bruges ikke af nogen klientkomponent", () => {
    const root = join(__dirname, "..");
    const offenders: string[] = [];
    for (const rel of globSync("**/*.{ts,tsx}", { cwd: root })) {
      if (/\.test\.|__tests__/.test(rel)) continue;
      const src = readFileSync(join(root, rel), "utf8");
      if (!/^\s*["']use client["']/m.test(src.slice(0, 400))) continue;
      for (const ns of SERVER_ONLY_NAMESPACES) {
        const re = new RegExp(
          `use(Safe)?Translations(<[^>]*>)?\\(\\s*["'\`]${ns}["'\`.]`,
        );
        if (re.test(src)) offenders.push(`${rel}: ${ns}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
