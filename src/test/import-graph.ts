/**
 * Statisk import-graf over src/ til tests, der vogter klientbundtet: hvilke
 * filer en browser-modul trækker med ind. Følger relative og `@/`-importer
 * med værdier; `import type`, rene `{ type X }`-importer og dynamiske
 * `import()` (eget chunk) tæller ikke med, ligesom i bundleren.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const SRC = resolve(__dirname, "..");

function resolveSpec(file: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(file), spec);
  else return null;
  const hit = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ].find((p) => existsSync(p) && statSync(p).isFile());
  return hit && /\.(ts|tsx)$/.test(hit) ? hit : null;
}

function isTypeOnly(clause: string): boolean {
  const named = clause.trim().match(/^\{([^}]*)\}$/);
  if (!named) return false;
  const names = named[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((s) => s.startsWith("type "));
}

/** Filer, som `file` importerer med værdier (løst til absolutte stier). */
export function valueImports(file: string): string[] {
  const code = readFileSync(file, "utf8");
  const out: string[] = [];
  const re =
    /(?:^|[;\n])\s*(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) {
    if (m[1] || isTypeOnly(m[2])) continue;
    const hit = resolveSpec(file, m[3]);
    if (hit) out.push(hit);
  }
  for (const m of code.matchAll(/^import\s+["']([^"']+)["']/gm)) {
    const hit = resolveSpec(file, m[1]);
    if (hit) out.push(hit);
  }
  return out;
}

/** Alle filer, der nås fra `entry` (relativ til src/) via værdi-importer. */
export function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [join(SRC, entry)];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...valueImports(file));
  }
  return seen;
}

/** Når `entry` frem til `target` (begge relative til src/)? */
export function reaches(entry: string, target: string): boolean {
  return reachableFrom(entry).has(join(SRC, target));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules")
        sourceFiles(p, out);
    } else if (
      /\.(ts|tsx)$/.test(e.name) &&
      !/\.(test|dbtest)\.tsx?$/.test(e.name)
    ) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Korteste import-kæde fra en `"use client"`-fil til `target` (relativ til
 * src/), eller null. Kæden er relativ til src/, så fejlbeskeden viser vejen.
 */
export function clientPathTo(target: string): string[] | null {
  const goal = join(SRC, target);
  const prev = new Map<string, string | null>();
  const queue: string[] = [];
  for (const file of sourceFiles(SRC)) {
    if (/^\s*["']use client["']/.test(readFileSync(file, "utf8"))) {
      prev.set(file, null);
      queue.push(file);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    if (file === goal) {
      const chain: string[] = [];
      for (let f: string | null = file; f; f = prev.get(f) ?? null) {
        chain.unshift(relative(SRC, f));
      }
      return chain;
    }
    for (const dep of valueImports(file)) {
      if (!prev.has(dep)) {
        prev.set(dep, file);
        queue.push(dep);
      }
    }
  }
  return null;
}
