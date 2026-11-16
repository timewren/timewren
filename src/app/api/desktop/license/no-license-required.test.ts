import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ruterne importeres dynamisk og src-træet læses; det er langsomt, når hele
// suiten kører parallelt.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// #1009: ingen serverfunktion må kræve en licensnøgle. Nøgler hører kun til
// distributionspolitikken for de officielle desktop-builds. Testen kører mod en
// server uden billing-env, med syntetiske nøgler (ingen kundedata).

type Row = Record<string, unknown>;
const tables = {
  desktopLicenses: [] as Row[],
  desktopLicenseDevices: [] as Row[],
  desktopDevices: [] as Row[],
  desktopTrials: [] as Row[],
};
type TableName = keyof typeof tables;

// Drizzle-tabellerne er rene objekter; vi kender dem på identitet.
const schemaRef: Record<string, unknown> = {};
const nameOf = (t: unknown): TableName =>
  Object.entries(schemaRef).find(([, v]) => v === t)?.[0] as TableName;

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  // Betingelserne er ligegyldige for fakes: rækker filtreres på lighed nedenfor
  eq: (col: { name: string }, val: unknown) => ({ col: col.name, val }),
  and: (...c: unknown[]) => ({ all: c }),
}));

let nextId = 0;

function matches(row: Row, cond: unknown): boolean {
  const c = cond as { all?: unknown[]; col?: string; val?: unknown };
  if (!c || (!c.all && c.col === undefined))
    throw new Error(`ukendt where-form i fake-db: ${JSON.stringify(cond)}`);
  if (c.all) return c.all.every((x) => matches(row, x));
  const key = Object.keys(row).find(
    (k) => k.toLowerCase() === (c.col ?? "").replace(/_/g, "").toLowerCase(),
  );
  if (key === undefined)
    throw new Error(
      `ukendt kolonne i fake-db: ${c.col} (række: ${Object.keys(row)})`,
    );
  return row[key] === c.val;
}

vi.mock("@/lib/db", () => {
  const query = (name: TableName) => ({
    findFirst: async ({ where }: { where: unknown }) =>
      tables[name].find((r) => matches(r, where)),
  });
  return {
    db: {
      query: {
        desktopLicenses: query("desktopLicenses"),
        desktopLicenseDevices: query("desktopLicenseDevices"),
        desktopDevices: query("desktopDevices"),
        desktopTrials: query("desktopTrials"),
      },
      select: () => ({
        from: (t: unknown) => ({
          where: async (w: unknown) =>
            tables[nameOf(t)].filter((r) => matches(r, w)),
        }),
      }),
      insert: (t: unknown) => ({
        values: async (v: Row) => {
          tables[nameOf(t)].push({ id: `id-${++nextId}`, ...v });
        },
      }),
      update: (t: unknown) => ({
        set: (v: Row) => ({
          where: async (w: unknown) => {
            for (const r of tables[nameOf(t)])
              if (matches(r, w)) Object.assign(r, v);
          },
        }),
      }),
      delete: (t: unknown) => ({
        where: async (w: unknown) => {
          const name = nameOf(t);
          tables[name] = tables[name].filter((r) => !matches(r, w));
        },
      }),
    },
  };
});

const KEY = "TT-TEST-AAAA-BBBB-CCCC";
const MACHINE = "machine-test-1";

function post(url: string, body: unknown) {
  return new Request(`https://selfhost.example.test${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.9.9.9",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // Server uden billing: ingen betalingsudbyder, ingen Stripe-webhook-secret
  for (const v of [
    "ALUNTA_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STORE_BILLING_ENABLED",
  ]) {
    vi.stubEnv(v, "");
  }
  // Uden internet: enhver udgående forespørgsel fra en rute er en fejl
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("netværk blokeret i test");
    }),
  );
  const schema = await import("@/lib/db/schema");
  Object.assign(schemaRef, {
    desktopLicenses: schema.desktopLicenses,
    desktopLicenseDevices: schema.desktopLicenseDevices,
    desktopDevices: schema.desktopDevices,
    desktopTrials: schema.desktopTrials,
  });
  for (const k of Object.keys(tables)) tables[k as TableName] = [];
  tables.desktopLicenses.push({
    id: "lic-1",
    licenseKey: KEY,
    tier: "lifetime",
    maxDevices: 2,
    isActive: true,
    expiresAt: null,
    userId: "user-1",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("licensnøgler uden billing-env (syntetisk nøgle)", () => {
  it("aktiverer, verificerer og deaktiverer via /api/desktop/license/*", async () => {
    const activate = await import("./activate/route");
    const verify = await import("./verify/route");
    const deactivate = await import("./deactivate/route");

    const a = await activate.POST(
      post("/", { licenseKey: KEY, machineId: MACHINE }),
    );
    expect(a.status).toBe(200);
    const { proof } = await a.json();
    expect(proof).toMatchObject({
      license_key: KEY,
      tier: "lifetime",
      devices_allowed: 2,
    });
    expect(typeof proof.signature).toBe("string");

    const v = await verify.GET(new NextRequest(`https://x.test/?key=${KEY}`));
    expect(await v.json()).toMatchObject({ valid: true, tier: "lifetime" });

    const d = await deactivate.POST(
      post("/", { licenseKey: KEY, machineId: MACHINE }),
    );
    expect(await d.json()).toMatchObject({
      success: true,
      devicesRemaining: 0,
    });
  });

  it("kompatibilitetslaget /api/licenses/* virker uændret med snake_case", async () => {
    const activate = await import("@/app/api/licenses/activate/route");
    const verify = await import("@/app/api/licenses/verify/route");
    const deactivate = await import("@/app/api/licenses/deactivate/route");

    const a = await activate.POST(
      post("/", { license_key: KEY, machine_id: MACHINE }),
    );
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({
      license_key: KEY,
      tier: "lifetime",
      devices_allowed: 2,
    });

    const v = await verify.GET(new NextRequest(`https://x.test/?key=${KEY}`));
    expect(v.status).toBe(200);
    expect(await v.json()).toMatchObject({
      license_key: KEY,
      tier: "lifetime",
    });

    const d = await deactivate.POST(
      post("/", { license_key: KEY, machine_id: MACHINE }),
    );
    expect(d.status).toBe(200);
  });

  it("afviser stadig en ukendt nøgle (testen kan fejle)", async () => {
    const activate = await import("./activate/route");
    const res = await activate.POST(
      post("/", { licenseKey: "TT-NOPE-NOPE-NOPE-NOPE", machineId: MACHINE }),
    );
    expect(res.status).toBe(404);
  });

  it("prøveperioden kræver ingen nøgle", async () => {
    const trial = await import("./trial/route");
    const res = await trial.POST(post("/", { machineId: "m-trial" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ days_remaining: 30 });
  });
});

// Statisk vagt: kun licens-, auth-/token-, admin- og Stripe-ruterne må røre
// desktopLicenses. En ny licenstjek i fx sync, settings eller update giver rød.
const SRC = join(__dirname, "../../../..");
const ALLOWED_LICENSE_READERS = [
  /^app\/api\/desktop\/license\//,
  /^app\/api\/licenses\//,
  /^app\/api\/desktop\/auth\/(approve|token)\//,
  /^app\/api\/desktop\/admin\/licenses\//,
  /^app\/api\/webhooks\/stripe\//,
  /^lib\/trpc\/routers\/(admin\/)?desktop\.ts$/,
  /^lib\/(db\/schema|desktop-auth|account-deletion|stripe|config)\.ts$/,
  /^lib\/export\//,
  /^lib\/email\//,
  // Kendte visnings-/formularfiler (klient eller e-mail): viser en nøgle, låser intet
  /^app\/\(app\)\/admin\/desktop\/page\.tsx$/,
  /^app\/\(app\)\/dashboard\/settings\/desktop\/page\.tsx$/,
  /^components\/desktop\/DesktopRefundForm\.tsx$/,
  /^components\/email\/DesktopLicenseEmail\.tsx$/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

function licenseReadersOutside(
  files: { path: string; text: string }[],
  allowed: RegExp[] = ALLOWED_LICENSE_READERS,
): string[] {
  return files
    .filter((f) => /desktopLicenses|licenseKey/.test(f.text))
    .map((f) => f.path)
    .filter((p) => !allowed.some((re) => re.test(p)));
}

describe("ingen serverfunktion er låst bag en licens", () => {
  it("kun de godkendte filer læser licenstabellen", () => {
    const files = walk(SRC)
      .filter((p) => !/\/(marketing)\//.test(p) && !/\(marketing\)/.test(p))
      .map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));
    expect(licenseReadersOutside(files)).toEqual([]);
  });

  it("vagten kan fejle: en licenstjek i sync-ruten opdages", () => {
    const planted = {
      path: "app/api/desktop/sync/pull/route.ts",
      text: "const l = await db.query.desktopLicenses.findFirst({})",
    };
    expect(licenseReadersOutside([planted])).toEqual([planted.path]);
  });

  it("sync-, settings- og update-ruterne bruger ikke tier fra token eller licens", () => {
    const routes = walk(join(SRC, "app/api/desktop")).filter((p) =>
      /\/(sync|settings|update)\//.test(p),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const p of routes) {
      // Sync-push må kun bruge kapacitetsgrænsen for aktive kunder (åben uden
      // billing, bevist nedenfor); al anden tier-/plan-brug er en lås.
      const text = readFileSync(p, "utf8").replace(
        /^import \{ assertCanAddActiveClient \} from "@\/lib\/billing\/plan-limits";$/m,
        "",
      );
      expect(text, p).not.toMatch(/\btier\b|\bplan\b|\bisPro\b/);
    }
  });
});

describe("ingen plan-gate uden billing-env", () => {
  it("resolvePlanTier giver null (alt åbent) uden betalingsudbyder og rører ikke databasen", async () => {
    const { resolvePlanTier } = await import("@/lib/trpc/trpc");
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error("databasen må ikke røres uden billing");
        },
      },
    );
    const tier = await resolvePlanTier({
      db: db as never,
      session: { user: { id: "user-1" } },
      orgId: "org-1",
    });
    expect(tier).toBeNull();
  });

  it("kapacitetsgrænsen for aktive kunder (sync-push) er åben uden billing", async () => {
    const { assertCanAddActiveClient } = await import(
      "@/lib/billing/plan-limits"
    );
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error("databasen må ikke røres uden billing");
        },
      },
    );
    await expect(
      assertCanAddActiveClient(db as never, {
        planTier: "free",
        orgId: "org-1",
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("vagten kan fejle: med billing-env slår planen op i databasen", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_syntetisk");
    const { resolvePlanTier } = await import("@/lib/trpc/trpc");
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error("opslag");
        },
      },
    );
    await expect(
      resolvePlanTier({
        db: db as never,
        session: { user: { id: "user-1" } },
        orgId: "org-1",
      }),
    ).rejects.toThrow();
  });
});
