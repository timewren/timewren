/**
 * "Ingen låste funktioner" (#1011, del af #915).
 *
 * Billing må kun styre fakturering, prøveperiode og kapacitet (brugere, aktive
 * kunder, lagerplads). Den må aldrig afgøre, om et modul eller en procedure er
 * tilgængelig. Testen afgør det mekanisk:
 *
 *  1. Alle procedurer bag `moduleWriteProcedure` findes i den rigtige appRouter
 *     (ikke fra en håndskrevet liste) og kører deres egne middleware (login,
 *     abonnementsvagt, rolleadgang, erhvervs-tier) mod en række planer.
 *  2. Uden billing-env må INGEN afvise, uanset plan, prøve eller medlemsrække.
 *  3. Med Cloud-env må kun kapacitet (pladser) og de kendte afvigelser afvise.
 *  4. Modul-seedingen gør alle MODULE_KEYS tilgængelige uden billing.
 *  5. Ingen ny router-fil må tage tier-beslutninger uden at stå på listen.
 *
 * Kendte afvigelser står i KNOWN_DEVIATIONS (ikke som skip). En afvigelse, der
 * ikke længere udløses, fejler testen, så posten bliver fjernet sammen med
 * låsen. En NY lås fejler, fordi den ikke står på listen.
 *
 * Afgrænsning (bevidst): rolle- og modulopslag (`resolveModuleAccess`,
 * `resolveModules`) er mocket til "write"/tomt, fordi testen kun afgør, om
 * PLANEN låser noget. En lås i requireModuleAccess eller guardedRouter, der
 * afhænger af billing via modulrækker, fanges derfor ikke her; seedingen af
 * modulrækkerne dækkes af MODULE_KEYS-testene. `moduleReadProcedure` er ikke
 * med (opgaven nævner kun moduleWriteProcedure); den har ingen plan-middleware.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FREE_MEMBER_LOCKED_MESSAGE } from "@/lib/billing/plan-gate";
import { MODULE_KEYS } from "@/lib/modules/constants";
import { PERMISSION_MODULE_KEYS } from "@/lib/permissions/role-access";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-1"),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("../routers/enterprise/middleware", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../routers/enterprise/middleware")
  >()),
  resolveModules: vi.fn(async () => ({})),
}));
// Rolle-/modulopslag er ikke emnet her, kun planen
vi.mock("@/lib/permissions/role-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions/role-access")>()),
  resolveModuleAccess: vi.fn(async () => "write"),
}));
vi.mock("@/lib/realtime", () => ({ publishDataChanged: vi.fn() }));
vi.mock("@/lib/modules/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/modules/cache")>()),
  invalidateOrgModules: vi.fn(async () => undefined),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

// Registrér hvilke middleware moduleWriteProcedure(key) lægger på. Procedurer
// bygget af dem bærer de samme funktionsreferencer i deres kæde, så vi kan
// finde dem i appRouter uden en håndskrevet liste.
const moduleMiddlewares = vi.hoisted(() => ({
  byFn: new Map<unknown, string>(),
  /** Antal middleware moduleWriteProcedure lægger oven på subscribedProcedure */
  added: new Set<number>(),
}));
vi.mock("../trpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../trpc")>();
  return {
    ...actual,
    moduleWriteProcedure: (key: string) => {
      const builder = actual.moduleWriteProcedure(key as never);
      const defOf = (b: unknown) =>
        (b as { _def: { middlewares: unknown[] } })._def.middlewares;
      const chain = defOf(builder);
      // Alt oven på subscribedProcedure er modulets egne middleware
      // (requireModuleAccess); antallet kontrolleres i opdagelsestesten, så en
      // ny middleware (fx en tier-lås) ikke bliver overset.
      const added = chain.length - defOf(actual.subscribedProcedure).length;
      moduleMiddlewares.added.add(added);
      for (const mw of chain.slice(chain.length - added)) {
        moduleMiddlewares.byFn.set(mw, key);
      }
      return builder;
    },
  };
});

type Middleware = (opts: Record<string, unknown>) => Promise<unknown>;
type ProcedureDef = { type: string; middlewares: Middleware[] };
type ModuleProcedure = {
  path: string;
  moduleKey: string;
  type: string;
  chain: Middleware[];
};

const moduleProcedures: ModuleProcedure[] = [];

beforeAll(async () => {
  const { appRouter } = await import("../routers");
  const procedures = (
    appRouter._def as unknown as {
      procedures: Record<string, { _def: ProcedureDef }>;
    }
  ).procedures;
  for (const [path, proc] of Object.entries(procedures)) {
    const chain = proc._def.middlewares;
    let last = -1;
    let moduleKey = "";
    chain.forEach((mw, i) => {
      const hit = moduleMiddlewares.byFn.get(mw);
      if (hit) {
        last = i;
        moduleKey = hit;
      }
    });
    if (last >= 0) {
      moduleProcedures.push({
        path,
        moduleKey,
        type: proc._def.type,
        // Alt til og med erhvervs-tieren; input og resolver køres ikke
        chain: chain.slice(0, last + 1),
      });
    }
  }
}, 120_000);

// ---------------------------------------------------------------------------
// Scenarier
// ---------------------------------------------------------------------------

type Sub = {
  status: string;
  planTier: string | null;
  trialEndsAt: Date;
  pastDueSince: Date | null;
} | null;

interface Scenario {
  name: string;
  sub: Sub;
  /** Antal medlemmer i orgen; brugeren er det yngste (nr. 4+ er låst på Gratis). */
  memberCount?: number;
  /** Faktureringstilstand: abonnement mangler/er udløbet. Må afvise med Cloud-env. */
  billingState?: boolean;
  tier: string | null;
}

const DAY = 86_400_000;
const sub = (
  status: string,
  planTier: string | null,
  extra: Partial<NonNullable<Sub>> = {},
): Sub => ({
  status,
  planTier,
  trialEndsAt: new Date(0),
  pastDueSince: null,
  ...extra,
});

const NO_BILLING_SCENARIOS: Scenario[] = [
  { name: "intet abonnement", sub: null, tier: "ingen" },
  {
    name: "udløbet prøve",
    sub: sub("trialing", "solo", { trialEndsAt: new Date(Date.now() - DAY) }),
    tier: "solo",
  },
  { name: "opsagt", sub: sub("canceled", "solo"), tier: "solo" },
  {
    name: "past_due ud over henstand",
    sub: sub("past_due", "solo", {
      pastDueSince: new Date(Date.now() - 30 * DAY),
    }),
    tier: "solo",
  },
  { name: "Gratis", sub: sub("free", "free"), tier: "free" },
  { name: "Privat", sub: sub("active", "privat"), tier: "privat" },
  {
    name: "Gratis, medlem nr. 5",
    sub: sub("free", "free"),
    memberCount: 5,
    tier: "free",
  },
];

const CLOUD_SCENARIOS: Scenario[] = [
  { name: "intet abonnement", sub: null, tier: "ingen", billingState: true },
  {
    name: "udløbet prøve",
    sub: sub("trialing", "solo", { trialEndsAt: new Date(Date.now() - DAY) }),
    tier: "solo",
    billingState: true,
  },
  // Opsagt løses til Gratis (isFreeSubscription), så erhvervs-låsen gælder
  { name: "opsagt", sub: sub("canceled", "solo"), tier: "free" },
  {
    name: "past_due ud over henstand",
    sub: sub("past_due", "solo", {
      pastDueSince: new Date(Date.now() - 30 * DAY),
    }),
    tier: "solo",
    billingState: true,
  },
  { name: "Gratis", sub: sub("free", "free"), tier: "free" },
  { name: "Privat", sub: sub("active", "privat"), tier: "privat" },
  { name: "Selvstændig", sub: sub("active", "solo"), tier: "solo" },
  { name: "Team", sub: sub("active", "team"), tier: "team" },
  { name: "Business", sub: sub("active", "business"), tier: "business" },
  {
    name: "gyldig prøve",
    sub: sub("trialing", "solo", { trialEndsAt: new Date(Date.now() + DAY) }),
    tier: "solo",
  },
  {
    name: "past_due inden for henstand",
    sub: sub("past_due", "team", {
      pastDueSince: new Date(Date.now() - DAY),
    }),
    tier: "team",
  },
  {
    name: "Gratis, medlem nr. 5",
    sub: sub("free", "free"),
    memberCount: 5,
    tier: "free",
  },
];

/**
 * Fejl, der er tilladt med Cloud-env fordi de handler om kapacitet. Her kun
 * pladser: medlem ud over Gratis' brugergrænse. (Aktive kunder håndhæves i
 * clients.create/restore med planLimits, ikke i kæden her.)
 */
const CAPACITY_MESSAGES: readonly string[] = [FREE_MEMBER_LOCKED_MESSAGE];

/**
 * Fejl, der er tilladt med Cloud-env fordi de handler om fakturering/prøve:
 * abonnementet mangler eller er udløbet. Kun tilladt i scenarier markeret
 * `billingState`; i et aktivt, gyldigt scenarie ville de være en lås.
 * (Teksterne står i resolvePlanTier i trpc.ts.)
 */
const BILLING_STATE_MESSAGES: readonly string[] = [
  "Du har brug for et aktivt abonnement for at bruge denne funktion",
  "Dit abonnement er udløbet. Forny venligst for at fortsætte.",
];

/**
 * Kendte afvigelser: låse, der findes i dag og som ikke er kapacitet.
 * Hver post skal udløses mindst én gang, ellers fejler testen (fjern posten
 * sammen med låsen). Kilde: docs/research/2026-11-05-timewren-oss-cloud-model.md
 * afsnit 4.2 og 5.1.
 */
const KNOWN_DEVIATIONS: ReadonlyArray<{
  id: string;
  /**
   * Issue der fjerner låsen. OBS: issuet er ikke oprettet/nummereret endnu
   * (agenten kan ikke se GitHub); udfyld "#N" her, når det findes.
   */
  issue: string;
  /** Hvor afvigelsen kan ses */
  kind: "procedure-chain" | "module-seed";
  moduleKeys?: readonly string[];
  tiers?: readonly string[];
  message?: string;
}> = [
  // "business-tier-lock" (#1012), "enterprise-module-unavailable" (#1035) og
  // "resource-plan-tier-lock" (#1011) er fjernet sammen med låsene. Listen er tom.
];
const DEVIATION_IDS = KNOWN_DEVIATIONS.map((d) => d.id);

function deviationFor(
  moduleKey: string,
  tier: string | null,
  message: string,
): string | null {
  const hit = KNOWN_DEVIATIONS.find(
    (d) =>
      d.kind === "procedure-chain" &&
      d.moduleKeys?.includes(moduleKey) &&
      tier !== null &&
      d.tiers?.includes(tier) &&
      d.message === message,
  );
  return hit?.id ?? null;
}

// ---------------------------------------------------------------------------
// Kørsel af en procedures kæde
// ---------------------------------------------------------------------------

function makeDb(scenario: Scenario) {
  const memberCount = scenario.memberCount ?? 1;
  // Brugeren (u1) er yngst; de øvrige er ældre medlemmer
  const rows = Array.from({ length: memberCount }, (_, i) => ({
    userId: i === memberCount - 1 ? "u1" : `other-${i}`,
    role: i === 0 && memberCount > 1 ? "owner" : "member",
    createdAt: new Date(2026, 0, 1 + i),
  }));
  return {
    query: {
      users: { findFirst: vi.fn(async () => ({ role: "user" })) },
      subscriptions: {
        findFirst: vi.fn(async () => scenario.sub ?? undefined),
      },
      members: { findFirst: vi.fn(async () => ({ role: "owner" })) },
    },
    select: vi.fn(() => ({
      from: () => ({ where: vi.fn().mockResolvedValue(rows) }),
    })),
  };
}

async function runChain(
  proc: ModuleProcedure,
  scenario: Scenario,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const baseCtx = {
    session: { user: { id: "u1" } },
    db: makeDb(scenario),
    headers: null,
  };
  const step = async (
    i: number,
    ctx: Record<string, unknown>,
  ): Promise<unknown> => {
    if (i === proc.chain.length) return { ok: true, data: undefined };
    return proc.chain[i]({
      ctx,
      path: proc.path,
      type: proc.type,
      input: undefined,
      getRawInput: async () => undefined,
      meta: undefined,
      signal: undefined,
      next: async (opts?: { ctx?: Record<string, unknown> }) =>
        step(i + 1, opts?.ctx ? { ...ctx, ...opts.ctx } : ctx),
    });
  };
  try {
    await step(0, baseCtx);
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return {
      ok: false,
      code: e.code ?? "UNKNOWN",
      message: e.message ?? String(err),
    };
  }
}

const noBillingEnv = () => {
  vi.stubEnv("ALUNTA_API_KEY", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("STORE_BILLING_ENABLED", "");
};
const cloudEnv = () => {
  vi.stubEnv("ALUNTA_API_KEY", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("STORE_BILLING_ENABLED", "1");
};

afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ingen låste funktioner: procedurer bag moduleWriteProcedure", () => {
  it("finder procedurerne i appRouter og dækker erhvervsmodulerne", () => {
    // Hvis opdagelsen går i stykker, ville resten bestå tomt
    expect(moduleProcedures.length).toBeGreaterThan(40);
    const keys = new Set(moduleProcedures.map((p) => p.moduleKey));
    expect(keys.has("invoices")).toBe(true);
    expect(keys.has("klippekort")).toBe(true);
    // Præcis requireModuleAccess oven på subscribedProcedure (ingen tier-lås, #1012)
    expect([...moduleMiddlewares.added]).toEqual([1]);
    for (const k of keys) {
      expect(PERMISSION_MODULE_KEYS as readonly string[]).toContain(k);
    }
  });

  it("uden billing-env afviser ingen procedure, uanset plan, prøve eller medlemsrække", async () => {
    noBillingEnv();
    const failures: string[] = [];
    for (const proc of moduleProcedures) {
      for (const scenario of NO_BILLING_SCENARIOS) {
        const res = await runChain(proc, scenario);
        if (!res.ok) {
          failures.push(
            `${proc.path} [${proc.moduleKey}] / ${scenario.name}: ${res.code} ${res.message}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("med Cloud-env afviser kun kapacitet og kendte afvigelser", async () => {
    cloudEnv();
    const unexpected: string[] = [];
    const hitDeviations = new Set<string>();
    for (const proc of moduleProcedures) {
      for (const scenario of CLOUD_SCENARIOS) {
        const res = await runChain(proc, scenario);
        if (res.ok) continue;
        if (CAPACITY_MESSAGES.includes(res.message)) continue;
        if (
          scenario.billingState &&
          BILLING_STATE_MESSAGES.includes(res.message)
        )
          continue;
        const dev = deviationFor(proc.moduleKey, scenario.tier, res.message);
        if (dev) {
          hitDeviations.add(dev);
          continue;
        }
        unexpected.push(
          `${proc.path} [${proc.moduleKey}] / ${scenario.name}: ${res.code} ${res.message}`,
        );
      }
    }
    expect(unexpected).toEqual([]);
    // Ingen procedure-afvigelser tilbage; en ny post skal tilføjes eksplicit
    expect([...hitDeviations]).toEqual([]);
  });

  it("kapacitetsbeskeden udløses faktisk (positiv kontrol), og kun med Cloud-env", async () => {
    cloudEnv();
    const proc = moduleProcedures.find((p) => p.moduleKey === "projects");
    expect(proc).toBeDefined();
    const member5: Scenario = {
      name: "Gratis, medlem nr. 5",
      sub: sub("free", "free"),
      memberCount: 5,
      tier: "free",
    };
    expect(await runChain(proc as ModuleProcedure, member5)).toMatchObject({
      ok: false,
      message: FREE_MEMBER_LOCKED_MESSAGE,
    });
    noBillingEnv();
    expect(await runChain(proc as ModuleProcedure, member5)).toEqual({
      ok: true,
    });
  });

  it("ressourceplanen har ingen plan-lås: hverken i adgangslogik, router eller navigation", () => {
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const LOCK =
      /planTier|tierAllows|PLAN_TIER_REQUIRED|resourcePlanTier|requiresTeamPlan|teamPlan/;
    for (const rel of [
      "../../resource-plan/access.ts",
      "../routers/resourcePlan.ts",
      "../../../components/dashboard-nav/navigation-config.ts",
    ]) {
      expect(LOCK.test(read(rel)), rel).toBe(false);
    }
  });

  it("hver kendt afvigelse har en henvisning", () => {
    for (const d of KNOWN_DEVIATIONS) {
      expect(d.issue.length, d.id).toBeGreaterThan(10);
    }
  });
});

describe("ingen låste funktioner: MODULE_KEYS", () => {
  async function seededAvailability(): Promise<Map<string, boolean>> {
    const { seedNewOrgModules } = await import("@/lib/modules/bundles");
    let rows: Array<{ moduleKey: string; isAvailable: boolean }> = [];
    const db = {
      insert: () => ({
        values: (r: typeof rows) => {
          rows = r;
          return { onConflictDoNothing: async () => undefined };
        },
      }),
    };
    await seedNewOrgModules(db as never, "org-1");
    return new Map(rows.map((r) => [r.moduleKey, r.isAvailable]));
  }

  it("uden billing-env er alle moduler tilgængelige for en ny organisation", async () => {
    noBillingEnv();
    const avail = await seededAvailability();
    for (const key of MODULE_KEYS) {
      expect(avail.get(key), `modul ${key}`).toBe(true);
    }
  });

  it("med Cloud-env er alle moduler tilgængelige for en ny organisation (#1035)", async () => {
    cloudEnv();
    const avail = await seededAvailability();
    const unavailable = MODULE_KEYS.filter((k) => !avail.get(k));
    expect(unavailable).toEqual([]);
  });
});

describe("ingen låste funktioner: nye tier-beslutninger i routerne", () => {
  // Filer i src/lib/trpc/routers der må bruge tier-låsende primitiver
  // (`ctx.planTier`, `tierAllows…`, `BUSINESS_FEATURE_MESSAGE`,
  // `isFreeTierMemberLocked`). En ny fil her er en ny mulig lås: afgør om den
  // er kapacitet (tilføj som "capacity") eller en afvigelse (tilføj som
  // "deviation" med henvisning).
  const ALLOWED: Record<string, string> = {
    "clients.ts": "capacity: aktive kunder (planLimits)",
    "subscription.ts": "capacity: viser pladslås og abonnement, låser intet",
  };
  const PATTERN =
    /ctx\.planTier|tierAllows\w*|BUSINESS_FEATURE_MESSAGE|isFreeTierMemberLocked/;

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        return name === "__tests__" ? [] : walk(p);
      }
      return /\.tsx?$/.test(name) && !/\.(test|dbtest)\.tsx?$/.test(name)
        ? [p]
        : [];
    });
  }

  it("kun kendte routerfiler tager tier-beslutninger", () => {
    const root = fileURLToPath(new URL("../routers", import.meta.url));
    const users = walk(root)
      .filter((f) => PATTERN.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f).replaceAll("\\", "/"))
      .sort();
    expect(users).toEqual(Object.keys(ALLOWED).sort());
    // Hver afvigelsespost peger på en id i KNOWN_DEVIATIONS (og dermed et issue)
    for (const note of Object.values(ALLOWED)) {
      const id = /^deviation:([\w-]+)/.exec(note)?.[1];
      if (id) expect(DEVIATION_IDS).toContain(id);
    }
  });
});
