import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vagt for reglen i billing-enabled.ts (#1010): billing må kun styre
 * fakturering, prøveperiode, opgraderingsknapper og kapacitet, aldrig om et
 * modul, en procedure, en rapport eller en integration er tilgængelig.
 *
 * Hver fil, der rører `isBillingEnabled`, skal stå her med en klassifikation
 * og et antal forekomster (import tæller med). Et ekstra kald fejler testen.
 * En ny fil, der kalder gaten uden at være klassificeret, fejler testen, så
 * valget bliver truffet bevidst i stedet for at snige adgang ind bag billing.
 *
 * - "fakturering": betaling, prøveperiode, dunning, opgraderings-UI og
 *   abonnementstilstand (udløbet prøve, restance). Ikke plan-tier.
 *
 * Der findes bevidst ingen klasse for "adgang": en bruger af gaten, der styrer
 * om et modul, en procedure eller en integration er tilgængelig, skal ikke
 * klassificeres, men fjernes (#1010).
 *
 * Kapacitet (brugere, aktive kunder) kalder ikke `isBillingEnabled` direkte,
 * men `capacityLimitsApply` fra capacity-gate.ts.
 */
const CLASSIFIED: Record<string, { klasse: "fakturering"; antal: number }> = {
  "src/app/api/cron/trial-reminder/route.ts": {
    klasse: "fakturering",
    antal: 2,
  },
  "src/app/api/cron/trial-expire/route.ts": { klasse: "fakturering", antal: 2 },
  "src/app/api/cron/dunning/route.ts": { klasse: "fakturering", antal: 2 },
  "src/app/api/cron/seat-reconciliation/route.ts": {
    klasse: "fakturering",
    antal: 2,
  },
  "src/app/api/cron/drip-emails/route.ts": { klasse: "fakturering", antal: 2 },
  // Betalingsjobs er no-ops uden betalingsudbyder (#1014)
  "src/app/api/cron/admin-digest/route.ts": { klasse: "fakturering", antal: 2 },
  "src/app/api/cron/churn-playbooks/route.ts": {
    klasse: "fakturering",
    antal: 2,
  },
  "src/lib/trpc/routers/subscription.ts": { klasse: "fakturering", antal: 3 },
  // Abonnementstilstand (udløbet prøve, restance, pladslås), ikke plan-tier:
  // uden betalingsudbyder findes ingen abonnementer at udløbe (#1010).
  "src/lib/trpc/trpc.ts": { klasse: "fakturering", antal: 2 },
  "src/lib/trpc/routers/ext/entitlements.ts": {
    klasse: "fakturering",
    antal: 2,
  },
  "src/lib/recurring-invoices/plan.ts": { klasse: "fakturering", antal: 3 },
  // Modul-seeding (bundles.ts), modul-toggle og import (ext/import.ts) kalder
  // ikke længere gaten (#1035, #1012). Pladsgrænsen (checkSeatAvailability)
  // går gennem capacityLimitsApply.
};

const ROOT = process.cwd();
// Selve gaten og kapacitetsgaten (capacity-gate.ts) er undtaget fra scanningen.
const EXEMPT = new Set([
  "src/lib/billing/billing-enabled.ts",
  "src/lib/billing/capacity-gate.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
      ? [p]
      : [];
  });
}

/** Forekomster af `isBillingEnabled` pr. fil (import tæller med). */
const users = new Map<string, number>();
for (const f of sourceFiles(join(ROOT, "src"))) {
  const rel = relative(ROOT, f).split(sep).join("/");
  if (EXEMPT.has(rel)) continue;
  const n = (readFileSync(f, "utf8").match(/\bisBillingEnabled\b/g) ?? [])
    .length;
  if (n > 0) users.set(rel, n);
}

describe("isBillingEnabled må kun bruges til billing (#1010)", () => {
  it("alle brugere er klassificeret", () => {
    const unclassified = [...users.keys()].filter((f) => !(f in CLASSIFIED));
    expect(unclassified).toEqual([]);
  });

  it("klassifikationen indeholder ingen forældede filer", () => {
    const stale = Object.keys(CLASSIFIED).filter((f) => !users.has(f));
    expect(stale).toEqual([]);
  });

  it("antallet af kald pr. fil vokser ikke", () => {
    const actual = Object.fromEntries(users);
    const expected = Object.fromEntries(
      Object.entries(CLASSIFIED).map(([f, c]) => [f, c.antal]),
    );
    expect(actual).toEqual(expected);
  });

  it("kapacitetsfiler bruger capacity-gaten, ikke isBillingEnabled", () => {
    const capacityFiles = [
      "src/lib/billing/plan-limits.ts",
      "src/lib/org-seats.ts",
    ];
    for (const f of capacityFiles) {
      expect(users.has(f)).toBe(false);
      expect(readFileSync(join(ROOT, f), "utf8")).toMatch(
        /\bcapacityLimitsApply\b/,
      );
    }
  });

  it("pladsgrænsen i organization.ts går gennem capacity-gaten", () => {
    const src = readFileSync(
      join(ROOT, "src/lib/trpc/routers/organization.ts"),
      "utf8",
    );
    // checkSeatAvailability: kapacitet, ikke adgang
    expect(src).toMatch(/if \(!capacityLimitsApply\(\)\)/);
    // Intet direkte billing-kald tilbage: enterprise-modulet er åbent (#1035)
    expect(src).not.toMatch(/\bisBillingEnabled\b/);
  });
});
