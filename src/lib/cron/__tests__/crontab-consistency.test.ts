import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_INTERVAL_MINUTES } from "@/lib/cron/expected-schedule";

// Crontabben i cron/entrypoint.sh er den eneste, der kører i prod. Den,
// ruterne i src/app/api/cron og EXPECTED_INTERVAL_MINUTES (admin-
// monitoringens "tavs"-vurdering) skal derfor stemme overens. `import` og
// `refresh-tokens` manglede i crontabben i månedsvis uden at nogen opdagede
// det, fordi de kun stod i en forældet compose-fil (fjernet i #1103).

const root = resolve(__dirname, "../../../..");
const entrypoint = readFileSync(resolve(root, "cron/entrypoint.sh"), "utf8");

const crontab = new Map<string, string>();
for (const line of entrypoint.split("\n")) {
  const m = line.match(
    /^(\S+ \S+ \S+ \S+ \S+) curl .*\/api\/cron\/([\w-]+)\s*$/,
  );
  if (m) crontab.set(m[2], m[1]);
}

const routes = readdirSync(resolve(root, "src/app/api/cron"), {
  withFileTypes: true,
})
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

/** Groft interval i minutter ud fra et cron-udtryk. */
function intervalMinutes(expr: string): number {
  const [min, hour, dom, , dow] = expr.split(" ");
  const everyN = min.match(/^\*\/(\d+)$/);
  if (everyN && hour === "*") return Number(everyN[1]);
  if (hour === "*") return 60;
  if (dom !== "*") return 31 * 24 * 60;
  if (dow !== "*" && !dow.includes("-")) return 7 * 24 * 60;
  return 24 * 60;
}

describe("crontab i cron/entrypoint.sh", () => {
  it("planlægger hver cron-rute", () => {
    expect(routes.filter((r) => !crontab.has(r))).toEqual([]);
  });

  it("peger kun på ruter der findes", () => {
    expect([...crontab.keys()].filter((r) => !routes.includes(r))).toEqual([]);
  });

  it("har et forventet interval for hvert planlagt job", () => {
    expect(
      [...crontab.keys()].filter((r) => !(r in EXPECTED_INTERVAL_MINUTES)),
    ).toEqual([]);
  });

  it("forventer kun jobs der faktisk er planlagt", () => {
    expect(
      Object.keys(EXPECTED_INTERVAL_MINUTES).filter((j) => !crontab.has(j)),
    ).toEqual([]);
  });

  it("har forventede intervaller der matcher crontabben", () => {
    const mismatches = [...crontab].flatMap(([job, expr]) => {
      const actual = intervalMinutes(expr);
      const expected = EXPECTED_INTERVAL_MINUTES[job];
      // Månedlige jobs må stå som 30 eller 31 dage
      const monthlyOk = actual === 31 * 24 * 60 && expected >= 30 * 24 * 60;
      return expected === actual || monthlyOk
        ? []
        : [{ job, expr, actual, expected }];
    });
    expect(mismatches).toEqual([]);
  });

  it("giver hver curl en timeout, så et hængende kald ikke blokerer jobbet", () => {
    const curlLines = entrypoint
      .split("\n")
      .filter((l) => /^\S+ \S+ \S+ \S+ \S+ curl /.test(l));
    expect(curlLines.length).toBeGreaterThan(0);
    expect(curlLines.filter((l) => !l.includes("--max-time"))).toEqual([]);
  });
});
