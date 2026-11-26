/**
 * Rolleadgang pr. modul (rolePermissions: none/read/write) skal håndhæves på
 * læsninger og på skrivninger af skabeloner, ikke kun dér hvor routerne
 * tilfældigvis brugte moduleRead/WriteProcedure (#1116).
 *
 * Rolle-opslaget (resolveModuleAccess) er mocket, så testen afgør kun, om
 * proceduren spørger efter det rigtige modul og afviser med FORBIDDEN, når
 * rollen ikke rækker. Input og resolver køres ikke ved afvisning; ved adgang
 * må kaldet gerne fejle senere (input/mock-db), bare ikke med rollefejlen.
 */
import { TRPCError } from "@trpc/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
const access = vi.hoisted(() => ({
  level: "none" as "none" | "read" | "write",
}));
// Uden importOriginal: den ægte modul-fil indlæses ellers via en cirkulær
// import, før mocken er klar, og trpc.ts binder den ægte resolveModuleAccess.
vi.mock("@/lib/permissions/role-access", () => ({
  PERMISSION_MODULE_KEYS: [],
  resolveEffectiveOrgRole: vi.fn(async () => "member"),
  resolveModuleAccess: vi.fn(async () => access.level),
  accessSatisfies: (level: string, required: "read" | "write") =>
    required === "read"
      ? level === "read" || level === "write"
      : level === "write",
}));
vi.mock("@/lib/realtime", () => ({ publishDataChanged: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

function makeCallableProxy(): unknown {
  return new Proxy(() => Promise.resolve([]), {
    get: () => makeCallableProxy(),
    apply: () => Promise.resolve([]),
  });
}

// Læsninger, der tilhører modulet og derfor kræver mindst "read".
const READS: Record<string, { module: string; procedures: string[] }> = {
  clients: {
    module: "clients",
    procedures: [
      "listPage",
      "listWithStats",
      "getById",
      "count",
      "getAtRiskClients",
      "getTopClients",
    ],
  },
  projects: {
    module: "projects",
    procedures: [
      "listWithStats",
      "getById",
      "monthlyBudget",
      "count",
      "getStats",
      "healthStatus",
      "getBudgetAlerts",
    ],
  },
  tasks: {
    module: "tasks",
    procedures: [
      "list",
      "listByStatus",
      "getById",
      "getStats",
      "getUpcoming",
      "getOverdue",
      "getTodaysFocus",
      "listAttachments",
    ],
  },
  invoices: {
    module: "invoices",
    procedures: [
      "list",
      "listPage",
      "getByClient",
      "getById",
      "getNextInvoiceNumber",
      "getStats",
      "numberSeriesAudit",
      "getLines",
      "linesByInvoice",
    ],
  },
  prepaid: {
    module: "klippekort",
    procedures: [
      "getAssignableEntries",
      "getAssignableProjects",
      "getPackagesForEntries",
      "list",
      "getById",
      "listRenewalRequests",
      "getLowBalance",
      "getReport",
      "getExpiring",
      "listTemplates",
    ],
  },
  reports: {
    module: "reports",
    procedures: [
      "getRealRates",
      "listSchedules",
      "listShareLinks",
      "getReportData",
      "exportReport",
    ],
  },
  recurring: {
    module: "templates",
    procedures: ["list", "getByProject", "getById", "getPending"],
  },
  emailTemplates: {
    module: "templates",
    procedures: ["list", "getById", "getDefault", "getAvailableVariables"],
  },
  invoiceTemplates: {
    module: "templates",
    procedures: ["list", "getById", "getDefault"],
  },
};

// Skrivninger på organisationens mailskabeloner kræver "write".
const EMAIL_TEMPLATE_WRITES = [
  "create",
  "update",
  "duplicate",
  "delete",
  "setDefault",
  "createDefaults",
];

// Opslag, som tidsregistrering (timer, tidsposter, klippekort-fradrag) bruger
// på tværs af moduler. De forbliver åbne, så "none" på kunder/projekter/
// klippekort ikke stopper medlemmets egen tidsregistrering.
const CROSS_MODULE_LOOKUPS: Array<[string, string]> = [
  ["clients", "list"],
  ["projects", "list"],
  ["projects", "getByClient"],
  ["prepaid", "getActiveForClient"],
  ["recurring", "listActive"],
];

type Caller = Record<string, Record<string, (input?: unknown) => unknown>>;
let caller: Caller;
let roleAccessMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const [{ router }, routers, roleAccess] = await Promise.all([
    import("../trpc"),
    Promise.all([
      import("../routers/clients"),
      import("../routers/projects"),
      import("../routers/tasks"),
      import("../routers/invoices"),
      import("../routers/prepaid"),
      import("../routers/reports"),
      import("../routers/recurring"),
      import("../routers/emailTemplates"),
      import("../routers/invoiceTemplates"),
    ]),
    import("@/lib/permissions/role-access"),
  ]);
  roleAccessMock = vi.mocked(roleAccess.resolveModuleAccess) as never;
  const [
    { clientsRouter },
    { projectsRouter },
    { tasksRouter },
    { invoicesRouter },
    { prepaidRouter },
    { reportsRouter },
    { recurringRouter },
    { emailTemplatesRouter },
    { invoiceTemplatesRouter },
  ] = routers;
  const testRouter = router({
    clients: clientsRouter,
    projects: projectsRouter,
    tasks: tasksRouter,
    invoices: invoicesRouter,
    prepaid: prepaidRouter,
    reports: reportsRouter,
    recurring: recurringRouter,
    emailTemplates: emailTemplatesRouter,
    invoiceTemplates: invoiceTemplatesRouter,
  });
  caller = testRouter.createCaller({
    session: { user: { id: "u-member", role: "user" } },
    db: makeCallableProxy(),
    headers: null,
  } as never) as unknown as Caller;
}, 120_000);

beforeEach(() => {
  roleAccessMock.mockReset();
  roleAccessMock.mockImplementation(async () => access.level);
  // Uden betalingsudbyder, så abonnementsvagten foran getReport/listTemplates
  // ikke afviser før rolleadgangen; det er rollen, testen handler om.
  vi.stubEnv("ALUNTA_API_KEY", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("STORE_BILLING_ENABLED", "");
});

afterEach(() => vi.unstubAllEnvs());

async function call(router: string, proc: string): Promise<unknown> {
  try {
    await caller[router][proc]();
    return null;
  } catch (e) {
    return e;
  }
}

function isRoleDenied(err: unknown): boolean {
  return (
    err instanceof TRPCError &&
    err.code === "FORBIDDEN" &&
    /rolle/i.test(err.message)
  );
}

describe("rolleadgang på læsninger (#1116)", () => {
  for (const [routerKey, { module, procedures }] of Object.entries(READS)) {
    for (const proc of procedures) {
      it(`${routerKey}.${proc} afviser "none" på ${module}`, async () => {
        access.level = "none";
        const err = await call(routerKey, proc);
        expect(isRoleDenied(err)).toBe(true);
        expect(roleAccessMock).toHaveBeenCalledWith(
          expect.anything(),
          "u-member",
          "org-1",
          module,
        );
      });

      it(`${routerKey}.${proc} tillader "read" på ${module}`, async () => {
        access.level = "read";
        const err = await call(routerKey, proc);
        expect(isRoleDenied(err)).toBe(false);
      });
    }
  }
});

describe("rolleadgang på mailskabeloner (#1116)", () => {
  for (const proc of EMAIL_TEMPLATE_WRITES) {
    it(`emailTemplates.${proc} kræver "write" på templates`, async () => {
      access.level = "read";
      const err = await call("emailTemplates", proc);
      expect(isRoleDenied(err)).toBe(true);
      expect(roleAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        "u-member",
        "org-1",
        "templates",
      );
    });
  }
});

describe("tværgående opslag til tidsregistrering forbliver åbne", () => {
  for (const [routerKey, proc] of CROSS_MODULE_LOOKUPS) {
    it(`${routerKey}.${proc} slår ikke rolleadgang op`, async () => {
      access.level = "none";
      const err = await call(routerKey, proc);
      expect(isRoleDenied(err)).toBe(false);
      expect(roleAccessMock).not.toHaveBeenCalled();
    });
  }
});

// Delelinks og planlagte mails udleverer rapportdata uden om getReportData.
describe("rapporter kan ikke deles uden læseadgang (#1116)", () => {
  for (const proc of ["createShareLink", "createSchedule"]) {
    it(`reports.${proc} afviser "none" på reports`, async () => {
      access.level = "none";
      const err = await call("reports", proc);
      expect(isRoleDenied(err)).toBe(true);
      expect(roleAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        "u-member",
        "org-1",
        "reports",
      );
    });

    it(`reports.${proc} tillader "read" på reports`, async () => {
      access.level = "read";
      const err = await call("reports", proc);
      expect(isRoleDenied(err)).toBe(false);
    });
  }
});

describe('prepaid: "auto" i REST/MCP forbliver åben (#1116)', () => {
  it("slår projektets kunde op uden at kræve læseadgang til projekter", async () => {
    access.level = "none";
    const { resolveAutoPrepaidPackageId } = await import(
      "@/lib/api/prepaid-auto"
    );
    const err = await resolveAutoPrepaidPackageId(caller as never, {
      projectId: "00000000-0000-4000-8000-000000000001",
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isRoleDenied(err)).toBe(false);
    expect(roleAccessMock).not.toHaveBeenCalled();
  });
});

// Tidsregistreringen skal kunne vælge opgave og klippekort, selv når rollen
// har "none" på opgaver/klippekort. Smalle varianter kræver kun "time"-adgang.
const TIME_SCOPED_LOOKUPS: Array<[string, string]> = [
  ["tasks", "listForTime"],
  ["tasks", "getForTime"],
  ["prepaid", "listForTime"],
];

describe("opgave- og klippekortvalg i tidsregistrering (#1116)", () => {
  for (const [routerKey, proc] of TIME_SCOPED_LOOKUPS) {
    it(`${routerKey}.${proc} tillader "read" på time uden modulets egen adgang`, async () => {
      roleAccessMock.mockImplementation(
        async (_db: unknown, _u: string, _o: string, module: string) =>
          module === "time" ? "read" : "none",
      );
      const err = await call(routerKey, proc);
      expect(isRoleDenied(err)).toBe(false);
      expect(roleAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        "u-member",
        "org-1",
        "time",
      );
    });

    it(`${routerKey}.${proc} afviser "none" på time`, async () => {
      access.level = "none";
      const err = await call(routerKey, proc);
      expect(isRoleDenied(err)).toBe(true);
    });
  }
});

// Skrivninger på tilbagevendende tidsskabeloner kræver "write" på templates,
// ligesom læsningerne kræver "read".
describe("rolleadgang på tilbagevendende skabeloner (#1116)", () => {
  for (const proc of [
    "create",
    "update",
    "delete",
    "duplicate",
    "toggleActive",
    "pause",
    "resume",
  ]) {
    it(`recurring.${proc} kræver "write" på templates`, async () => {
      access.level = "read";
      const err = await call("recurring", proc);
      expect(isRoleDenied(err)).toBe(true);
      expect(roleAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        "u-member",
        "org-1",
        "templates",
      );
    });
  }
});

// Skrivningerne var åbne uden abonnement før rollevagten (#1116) og skal
// forblive det (moduleWriteNoSubProcedure). Med betaling slået til og intet
// gyldigt abonnement i mock-db'en afviser abonnementsvagten; kontrollen
// (tasks.create, moduleWriteProcedure) viser, at testen fanger den.
describe("tilbagevendende skabeloner: write slipper igennem uden abonnement", () => {
  const RECURRING_WRITES = [
    "create",
    "update",
    "delete",
    "duplicate",
    "toggleActive",
    "pause",
    "resume",
  ];

  function isForbidden(err: unknown): boolean {
    return err instanceof TRPCError && err.code === "FORBIDDEN";
  }

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  });

  it("kontrol: en abonnementskrævende skrivning afvises", async () => {
    access.level = "write";
    const err = await call("tasks", "create");
    expect(isForbidden(err)).toBe(true);
    expect(isRoleDenied(err)).toBe(false);
  });

  for (const proc of RECURRING_WRITES) {
    it(`recurring.${proc} tillader "write" på templates uden abonnement`, async () => {
      access.level = "write";
      const err = await call("recurring", proc);
      expect(isForbidden(err)).toBe(false);
      expect(roleAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        "u-member",
        "org-1",
        "templates",
      );
    });
  }
});
