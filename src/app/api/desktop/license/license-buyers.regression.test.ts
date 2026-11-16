/**
 * Regressionstest (#1034): købere af desktop-livstidslicensen beholder nøgle,
 * tre enheder, refusionsvindue og offline-bevis, uanset billing-env og brand.
 *
 * Kun syntetiske nøgler og maskin-id'er; ingen kundedata. Testen dokumenterer
 * adfærden som den er. Afvigelser er markeret "AFVIGELSE" og er ikke rettet
 * (se rapporten til #1034).
 *
 * DB'en er en lille in-memory fake: drizzles `eq`/`and`/`isNull` og skemaet er
 * mocket med simple prædikater, så ruterne kører uændret. Fakens grænse: en
 * kolonne, der findes i fake-tabellen, accepteres. Testen er derfor mutationsprøvet
 * mod activate-ruten (forkert opslagskolonne: 50 tests fejler; `>=` -> `>` på
 * enhedsgrænsen: 10 fejler).
 *
 * Brand/env-aksen er reel: modulerne genindlæses (vi.resetModules) efter
 * vi.stubEnv, så brand.ts, config og desktop-auth evalueres pr. case.
 *
 * AFVIGELSER nederst (deactivate frigiver ikke en plads for licenser uden konto;
 * for konto-knyttede tæller kun desktopDevices) er reelle fejl i forhold til
 * "deaktiver og frigiv enhed". Retter man dem, skal de tests vendes.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- fake DB ----------
type Row = Record<string, unknown> & { id: string };
type Pred = (row: Row) => boolean;

const store = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  let seq = 0;
  return {
    tables,
    reset() {
      for (const k of Object.keys(tables)) delete tables[k];
      seq = 0;
    },
    rows(name: string): Row[] {
      if (!tables[name]) tables[name] = [];
      return tables[name];
    },
    nextId() {
      seq += 1;
      return `id-${seq}`;
    },
  };
});

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq:
      (col: string, val: unknown): Pred =>
      (row) =>
        row[col] === val,
    and:
      (...preds: Pred[]): Pred =>
      (row) =>
        preds.every((p) => p(row)),
    isNull:
      (col: string): Pred =>
      (row) =>
        row[col] == null,
    desc: (col: string) => col,
  };
});

vi.mock("@/lib/db/schema", () => {
  const table = (name: string, cols: string[]) => ({
    __table: name,
    ...Object.fromEntries(cols.map((c) => [c, c])),
  });
  return {
    desktopLicenses: table("desktopLicenses", [
      "id",
      "userId",
      "licenseKey",
      "email",
      "isActive",
      "stripePaymentIntentId",
    ]),
    desktopLicenseDevices: table("desktopLicenseDevices", [
      "id",
      "licenseId",
      "machineId",
    ]),
    desktopDevices: table("desktopDevices", ["id", "userId", "machineId"]),
    desktopTrials: table("desktopTrials", ["id", "machineId"]),
    subscriptions: table("subscriptions", ["id"]),
    users: table("users", ["id"]),
  };
});

vi.mock("@/lib/db", () => {
  type Tbl = { __table: string };
  const findFirstFor = (name: string) => ({
    findFirst: async ({ where }: { where: Pred }) =>
      store.rows(name).find(where) ?? undefined,
    findMany: async ({ where }: { where: Pred }) =>
      store.rows(name).filter(where),
  });
  const db = {
    query: {
      desktopLicenses: findFirstFor("desktopLicenses"),
      desktopLicenseDevices: findFirstFor("desktopLicenseDevices"),
      desktopDevices: findFirstFor("desktopDevices"),
      desktopTrials: findFirstFor("desktopTrials"),
    },
    select: () => ({
      from: (t: Tbl) => ({
        where: async (p: Pred) =>
          store
            .rows(t.__table)
            .filter(p)
            .map((r) => ({ id: r.id })),
      }),
    }),
    insert: (t: Tbl) => ({
      values: async (v: Record<string, unknown>) => {
        store.rows(t.__table).push({ id: store.nextId(), ...v });
      },
    }),
    update: (t: Tbl) => ({
      set: (v: Record<string, unknown>) => ({
        where: async (p: Pred) => {
          for (const r of store.rows(t.__table)) if (p(r)) Object.assign(r, v);
        },
      }),
    }),
    delete: (t: Tbl) => ({
      where: async (p: Pred) => {
        store.tables[t.__table] = store.rows(t.__table).filter((r) => !p(r));
      },
    }),
  };
  return { db };
});

const refundCreate = vi.hoisted(() => vi.fn(async () => ({ id: "re_test" })));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ refunds: { create: refundCreate } }),
}));
vi.mock("@/lib/email/desktop-license", () => ({
  sendLicenseKeyEmail: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

// Modulerne indlæses dynamisk EFTER vi.stubEnv (+ vi.resetModules), så brand.ts,
// config og desktop-auth evalueres med den brand/env, en case kører med.
async function loadModules() {
  vi.resetModules();
  const [la, ld, lv, config, dbMod, auth, ui, trpc, da, dd, dt, dv] =
    await Promise.all([
      import("@/app/api/licenses/activate/route"),
      import("@/app/api/licenses/deactivate/route"),
      import("@/app/api/licenses/verify/route"),
      import("@/lib/config"),
      import("@/lib/db"),
      import("@/lib/desktop-auth"),
      import("@/lib/desktop-license-ui"),
      import("@/lib/trpc/routers/desktop"),
      import("./activate/route"),
      import("./deactivate/route"),
      import("./trial/route"),
      import("./verify/route"),
    ]);
  return {
    legacyActivate: la.POST,
    legacyDeactivate: ld.POST,
    legacyVerify: lv.GET,
    DESKTOP_LIFETIME_MAX_DEVICES: config.DESKTOP_LIFETIME_MAX_DEVICES,
    DESKTOP_REFUND_WINDOW_DAYS: config.DESKTOP_REFUND_WINDOW_DAYS,
    db: dbMod.db,
    signLicenseProof: auth.signLicenseProof,
    desktopBuyButtonLabel: ui.desktopBuyButtonLabel,
    desktopRouter: trpc.desktopRouter,
    activate: da.POST,
    deactivate: dd.POST,
    trial: dt.POST,
    verify: dv.GET,
  };
}
type Mods = Awaited<ReturnType<typeof loadModules>>;
let m: Mods;
let desktopApi: Api;
let legacyApi: Api;

// ---------- hjælpere ----------
const KEY = "TT-TEST-AAAA-BBBB-CCCC"; // syntetisk
const KEY_ACCOUNT = "TT-TEST-DDDD-EEEE-FFFF"; // syntetisk, knyttet til en bruger
const EMAIL = "koeber@example.test";
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-05T12:00:00Z");

let ipSeq = 0;
function post(path: string, body: unknown): Request {
  ipSeq += 1; // egen IP pr. kald, så den in-memory rate limiter ikke blander sig
  return new Request(`https://timetrack.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
    },
    body: JSON.stringify(body),
  });
}
function get(path: string): NextRequest {
  return new NextRequest(`https://timetrack.test${path}`);
}

function seedLicense(over: Record<string, unknown> = {}): Row {
  const row: Row = {
    id: store.nextId(),
    userId: null,
    licenseKey: KEY,
    tier: "lifetime",
    email: EMAIL,
    maxDevices: 3,
    isActive: true,
    stripePaymentIntentId: "pi_test",
    createdAt: new Date(NOW.getTime() - 2 * DAY),
    expiresAt: null,
    ...over,
  };
  store.rows("desktopLicenses").push(row);
  return row;
}

// Begge veje, vist som ét interface: { activate, deactivate, verify }.
// Svarene normaliseres til { status, proof?, body }.
// biome-ignore lint/suspicious/noExplicitAny: svarformerne er forskellige pr. rute
type ApiResult = { status: number; body: any };
interface Api {
  activate(key: string, machineId: string): Promise<ApiResult>;
  deactivate(key: string, machineId: string): Promise<ApiResult>;
  verify(key: string): Promise<ApiResult>;
}
const json = async (res: Response) => ({
  status: res.status,
  body: await res.json(),
});

const makeDesktopApi = (): Api => ({
  activate: async (key, machineId) =>
    json(
      await m.activate(
        post("/api/desktop/license/activate", {
          licenseKey: key,
          machineId,
          os: "linux",
        }),
      ),
    ),
  deactivate: async (key, machineId) =>
    json(
      await m.deactivate(
        post("/api/desktop/license/deactivate", { licenseKey: key, machineId }),
      ),
    ),
  verify: async (key) =>
    json(await m.verify(get(`/api/desktop/license/verify?key=${key}`))),
});
const makeLegacyApi = (): Api => ({
  activate: async (key, machineId) =>
    json(
      await m.legacyActivate(
        post("/api/licenses/activate", {
          license_key: key,
          machine_id: machineId,
          os: "linux",
          app_version: "0.2.19",
        }),
      ),
    ),
  deactivate: async (key, machineId) =>
    json(
      await m.legacyDeactivate(
        post("/api/licenses/deactivate", {
          license_key: key,
          machine_id: machineId,
        }),
      ),
    ),
  verify: async (key) =>
    json(
      await m.legacyVerify(
        get(`/api/licenses/verify?key=${key}&machine_id=m1`),
      ),
    ),
});

// Refusion går via tRPC (offentlig procedure), ikke via /api/*-ruterne.
function refundCaller() {
  return m.desktopRouter.createCaller({
    session: null,
    db: m.db,
    headers: null,
  } as never);
}

beforeEach(() => {
  store.reset();
  refundCreate.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------- matrix: billing-env x brand ----------
const BILLING = {
  tom: { ALUNTA_API_KEY: "", STRIPE_SECRET_KEY: "", STORE_BILLING_ENABLED: "" },
  sat: {
    ALUNTA_API_KEY: "test-alunta",
    STRIPE_SECRET_KEY: "sk_test_syntetisk",
    STORE_BILLING_ENABLED: "1",
  },
} as const;
const BRANDS = ["timetrack", "timewren"] as const;

const cases = BRANDS.flatMap((brand) =>
  (Object.keys(BILLING) as (keyof typeof BILLING)[]).map(
    (billing) => [brand, billing] as const,
  ),
);

describe.each(cases)("brand=%s, billing-env %s", (brand, billing) => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", brand);
    vi.stubEnv("BETTER_AUTH_SECRET", "golden-test-secret");
    for (const [k, v] of Object.entries(BILLING[billing])) vi.stubEnv(k, v);
    m = await loadModules();
    desktopApi = makeDesktopApi();
    legacyApi = makeLegacyApi();
    // Beviser at aksen virker: modulerne ser den brand, casen kører med.
    const { brand: active } = await import("@/lib/brand");
    expect(active.id).toBe(brand);
  });

  describe.each([
    ["/api/desktop/license/*", "desktop"],
    ["/api/licenses/* (kompatibilitet, desktop <= 0.2.19)", "legacy"],
  ] as const)("%s", (_name, kind) => {
    let api: Api;
    beforeEach(() => {
      api = kind === "desktop" ? desktopApi : legacyApi;
    });

    it("aktiverer, verificerer og deaktiverer en konto-knyttet nøgle", async () => {
      seedLicense({ licenseKey: KEY_ACCOUNT, userId: "user-test-1" });

      const act = await api.activate(KEY_ACCOUNT, "machine-1");
      expect(act.status).toBe(200);
      const proof = act.body.proof ?? act.body; // envelope vs. flad
      expect(proof.license_key).toBe(KEY_ACCOUNT);
      expect(proof.tier).toBe("lifetime");
      expect(proof.valid_until).toBeNull();
      expect(proof.devices_allowed).toBe(3);

      const ver = await api.verify(KEY_ACCOUNT);
      expect(ver.status).toBe(200);
      if (kind === "desktop") {
        expect(ver.body).toMatchObject({
          valid: true,
          tier: "lifetime",
          devicesUsed: 1,
          devicesAllowed: 3,
          expiresAt: null,
        });
      } else {
        expect(ver.body).toMatchObject({
          license_key: KEY_ACCOUNT,
          tier: "lifetime",
          valid_until: null,
          devices_allowed: 3,
        });
        expect(ver.body.verified_at).toBeTruthy();
      }

      const deact = await api.deactivate(KEY_ACCOUNT, "machine-1");
      expect(deact.status).toBe(200);
      expect(deact.body).toMatchObject({ success: true, devicesRemaining: 0 });
    });

    it("tillader tre enheder og afviser den fjerde (uden konto)", async () => {
      seedLicense();
      for (const m of ["m1", "m2", "m3"]) {
        expect((await api.activate(KEY, m)).status).toBe(200);
      }
      const fourth = await api.activate(KEY, "m4");
      expect(fourth.status).toBe(403);
      expect(fourth.body.error).toMatch(/Maximum devices reached \(3\)/);
      if (kind === "desktop") {
        expect(fourth.body).toMatchObject({
          devicesUsed: 3,
          devicesAllowed: 3,
        });
      }
      // Genaktivering af en kendt maskine tæller ikke som en ny enhed.
      expect((await api.activate(KEY, "m2")).status).toBe(200);
      expect(store.rows("desktopLicenseDevices")).toHaveLength(3);
    });

    it("tillader tre enheder og afviser den fjerde (konto-knyttet)", async () => {
      seedLicense({ licenseKey: KEY_ACCOUNT, userId: "user-test-1" });
      for (const m of ["m1", "m2", "m3"]) {
        expect((await api.activate(KEY_ACCOUNT, m)).status).toBe(200);
      }
      expect((await api.activate(KEY_ACCOUNT, "m4")).status).toBe(403);
      expect(store.rows("desktopDevices")).toHaveLength(3);
    });

    it("afviser ukendt, deaktiveret og udløbet nøgle på den rigtige måde", async () => {
      expect((await api.activate("TT-TEST-XXXX-XXXX-XXXX", "m1")).status).toBe(
        404,
      );

      seedLicense({ isActive: false });
      const off = await api.activate(KEY, "m1");
      expect(off.status).toBe(403);
      const verOff = await api.verify(KEY);
      if (kind === "desktop") {
        expect(verOff.body).toMatchObject({ valid: false, isActive: false });
      } else {
        // Autoritativt ugyldig => 403, så den gamle klient dropper beviset.
        expect(verOff.status).toBe(403);
      }

      store.reset();
      seedLicense({ expiresAt: new Date(NOW.getTime() - DAY) });
      expect((await api.activate(KEY, "m1")).status).toBe(403);
    });
  });

  describe("offline-bevis (signeret)", () => {
    it("er deterministisk, dækker nøgle/tier/lifetime/enheder og ændres ved manipulation", async () => {
      seedLicense();
      const res = await desktopApi.activate(KEY, "m1");
      const { signature, ...fields } = res.body.proof;
      expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(await m.signLicenseProof(fields)).toBe(signature);

      // Golden: fast secret + faste felter giver en fast signatur, så et
      // ændret signeringsformat (der ugyldiggør udstedte beviser) fanges.
      expect(
        await m.signLicenseProof({
          license_key: KEY,
          tier: "lifetime",
          valid_until: null,
          devices_allowed: 3,
          issued_at: "2026-11-03T12:00:00.000Z",
        }),
      ).toBe("C7754KV2jQE1-MJR6ZGEAsLyHfwzTRecYl62xlyh9iE");

      // Hvert felt er dækket af signaturen.
      expect(await m.signLicenseProof({ ...fields, tier: "team" })).not.toBe(
        signature,
      );
      expect(
        await m.signLicenseProof({ ...fields, devices_allowed: 99 }),
      ).not.toBe(signature);
      expect(
        await m.signLicenseProof({ ...fields, license_key: "TT-TEST-ZZZZ" }),
      ).not.toBe(signature);
      expect(
        await m.signLicenseProof({
          ...fields,
          valid_until: "2099-01-01T00:00:00.000Z",
        }),
      ).not.toBe(signature);
    });

    it("kompatibilitetsvejen giver det flade bevis den gamle klient forventer", async () => {
      seedLicense();
      const res = await legacyApi.activate(KEY, "m1");
      expect(Object.keys(res.body).sort()).toEqual(
        [
          "devices_allowed",
          "issued_at",
          "license_key",
          "tier",
          "valid_until",
          "verified_at",
        ].sort(),
      );
      // AFVIGELSE (dokumenteret, ikke rettet): det flade bevis har ingen
      // signatur; kun /api/desktop/license/activate returnerer `signature`.
      expect(res.body.signature).toBeUndefined();
    });

    it("transiente fejl på verify giver aldrig 401/403/410 (klienten bevarer offline-bevis)", async () => {
      const spy = vi.spyOn(m.db.query.desktopLicenses, "findFirst");
      spy.mockRejectedValueOnce(new Error("db nede"));
      const res = await legacyApi.verify(KEY);
      expect(res.status).toBe(500);
      expect([401, 403, 410]).not.toContain(res.status);
    });
  });

  describe("refusionsvindue", () => {
    it("er 30 dage; køb på dagen 30 kan refunderes, 1 ms efter kan ikke", async () => {
      expect(m.DESKTOP_REFUND_WINDOW_DAYS).toBe(30);
      expect(m.DESKTOP_LIFETIME_MAX_DEVICES).toBe(3);
      const windowMs = m.DESKTOP_REFUND_WINDOW_DAYS * DAY;

      const inside = seedLicense({
        createdAt: new Date(NOW.getTime() - windowMs),
      });
      await expect(
        refundCaller().requestRefund({ licenseKey: KEY, email: EMAIL }),
      ).resolves.toEqual({ success: true });
      expect(refundCreate).toHaveBeenCalledTimes(1);
      expect(inside.isActive).toBe(false);

      store.reset();
      refundCreate.mockClear();
      const outside = seedLicense({
        createdAt: new Date(NOW.getTime() - windowMs - 1),
      });
      await expect(
        refundCaller().requestRefund({ licenseKey: KEY, email: EMAIL }),
      ).rejects.toThrow(/Returretten på 30 dage er udløbet/);
      expect(refundCreate).not.toHaveBeenCalled();
      // Køberen beholder licensen, når vinduet er udløbet.
      expect(outside.isActive).toBe(true);
      expect((await desktopApi.activate(KEY, "m1")).status).toBe(200);
    });

    it("refusion deaktiverer nøglen og frigiver enhederne", async () => {
      seedLicense();
      await desktopApi.activate(KEY, "m1");
      await desktopApi.activate(KEY, "m2");
      expect(store.rows("desktopLicenseDevices")).toHaveLength(2);

      await refundCaller().requestRefund({ licenseKey: KEY, email: EMAIL });

      expect(store.rows("desktopLicenseDevices")).toHaveLength(0);
      expect((await desktopApi.activate(KEY, "m1")).status).toBe(403);
      expect((await desktopApi.verify(KEY)).body.valid).toBe(false);
      expect((await legacyApi.verify(KEY)).status).toBe(403);
    });

    it("refusion kræver matchende email (ingen refusion af andres nøgle)", async () => {
      seedLicense();
      await expect(
        refundCaller().requestRefund({
          licenseKey: KEY,
          email: "andre@example.test",
        }),
      ).rejects.toThrow(/matche licensnøgle og email/);
      expect(refundCreate).not.toHaveBeenCalled();
    });
  });

  describe("prøveperiode (billing styrer kun prøveperioden)", () => {
    it("starter på 30 dage og nulstilles ikke ved nyt kald", async () => {
      const first = await json(
        await m.trial(
          post("/api/desktop/license/trial", { machineId: "m-t1" }),
        ),
      );
      expect(first.body).toMatchObject({ days_remaining: 30 });

      vi.setSystemTime(new Date(NOW.getTime() + 10 * DAY));
      const again = await json(
        await m.trial(
          post("/api/desktop/license/trial", { machineId: "m-t1" }),
        ),
      );
      expect(again.body.started_at).toBe(first.body.started_at);
      expect(again.body.days_remaining).toBe(20);
    });
  });

  it("købeknappen er uafhængig af brand og billing-env", () => {
    expect(m.desktopBuyButtonLabel()).toBe("Køb licens (499 kr)");
  });
});

// ---------- afvigelser (dokumenteret adfærd, ikke rettet) ----------
describe("AFVIGELSER fra intentionen (adfærd som den er; se rapport #1034)", () => {
  it("deactivate frigiver ikke en plads for en licens uden konto (400)", async () => {
    seedLicense();
    for (const m of ["m1", "m2", "m3"]) await desktopApi.activate(KEY, m);

    for (const api of [desktopApi, legacyApi]) {
      const res = await api.deactivate(KEY, "m1");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("License is not assigned to a user");
    }
    // Pladsen er stadig optaget; en fjerde maskine kan ikke aktiveres.
    expect(store.rows("desktopLicenseDevices")).toHaveLength(3);
    expect((await desktopApi.activate(KEY, "m4")).status).toBe(403);
  });

  it("deactivate rører kun desktopDevices, ikke licensens egen enhedsliste", async () => {
    seedLicense({ licenseKey: KEY_ACCOUNT, userId: "user-test-1" });
    for (const m of ["m1", "m2", "m3"])
      await desktopApi.activate(KEY_ACCOUNT, m);

    const res = await desktopApi.deactivate(KEY_ACCOUNT, "m1");
    expect(res.body).toMatchObject({ success: true, devicesRemaining: 2 });

    // desktopLicenseDevices har stadig 3 rækker, så en ny maskine afvises
    // trods "devicesRemaining: 2".
    expect(store.rows("desktopLicenseDevices")).toHaveLength(3);
    expect((await desktopApi.activate(KEY_ACCOUNT, "m4")).status).toBe(403);
  });

  it("verify tæller kun enheder for konto-knyttede licenser (devicesUsed 0 uden konto)", async () => {
    seedLicense();
    await desktopApi.activate(KEY, "m1");
    expect((await desktopApi.verify(KEY)).body.devicesUsed).toBe(0);
  });
});
