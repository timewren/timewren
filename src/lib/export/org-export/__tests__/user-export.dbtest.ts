/**
 * Bruger-eksporten ("Hent dine egne data") mod en rigtig Postgres: to
 * organisationer, en medarbejder (Anna) i begge, en kollega (Bo) og en bruger
 * (Cat) uden for organisation X. Tjekker, at Anna får præcis sine egne rækker,
 * og at ingenting fra Bo, Cat eller en anden organisation slipper med, hverken
 * i rækkerne, i opslagene eller i selve ZIP-filen.
 *
 * Kører KUN med TT_DB_TESTS=1 og DATABASE_URL til en kasseret database med
 * repoets schema (se docs/testing/timer-model-tests.md).
 */

import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { collectZip } from "./collect-zip";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

// Jobbet streamer ZIP'en til objektlageret (#898). Her er der intet S3, så
// lageret erstattes af en modtager, der tæller bytes, mens ZIP'en skrives.
vi.mock("../storage", () => ({
  isExportStorageConfigured: () => true,
  deleteOrgExport: vi.fn(async () => {}),
  putOrgExportStream: vi.fn(
    async (
      _requestId: string,
      produce: (out: {
        write(chunk: Uint8Array): Promise<void>;
      }) => Promise<unknown>,
    ) => {
      await produce({ write: async () => {} });
    },
  ),
}));

const ENABLED = process.env.TT_DB_TESTS === "1";
process.env.ENCRYPTION_KEY ??= "d".repeat(64);

type Collected = Awaited<
  ReturnType<typeof import("../user-collect").collectUserExport>
>;

interface World {
  X: string;
  Y: string;
  anna: string;
  bo: string;
  cat: string;
  ids: Record<string, string>;
}

let d: {
  db: typeof import("@/lib/db").db;
  s: typeof import("@/lib/db/schema");
  collect: typeof import("../user-collect");
  zip: typeof import("../zip");
  job: typeof import("../job");
};
let w: World;

// Unikke tekster i andres rækker: findes de nogen steder i en brugers
// eksport, er der lækket.
const LEAK = {
  boNote: "LAEK-bo-note",
  boDesc: "LAEK-bo-beskrivelse",
  yDesc: "LAEK-org-y-beskrivelse",
  catDesc: "LAEK-cat-beskrivelse",
  clientY: "LAEK-kunde-i-org-y",
  unrefProject: "LAEK-projekt-ingen-peger-paa",
  boEmail: "bo-lakage@test.local",
  boName: "LAEK-Bo-Kollega",
  // Kunders oplysninger i Annas EGNE rækker (ikke kollegers eller andre orgs):
  // de må heller ikke med.
  customerBefore: "LAEK-kundemail-for@kunde.test",
  customerAfter: "LAEK-kundemail-efter@kunde.test",
  activityMeta: "LAEK-aktivitet-metadata",
  deliveryTo: "LAEK-faktura-modtager@kunde.test",
  filterSender: "LAEK-filter-afsender@kunde.test",
};

function rowsOf(c: Collected, key: string): Record<string, unknown>[] {
  const t = c.find((x) => x.entry.key === key);
  if (!t) throw new Error(`Ingen tabel ${key}`);
  return t.rows;
}
const idsOf = (c: Collected, key: string) =>
  rowsOf(c, key)
    .map((r) => r.id as string)
    .sort();

async function seed(): Promise<World> {
  const sfx = randomUUID().slice(0, 8);
  const X = `org-x-${sfx}`;
  const Y = `org-y-${sfx}`;
  const anna = `u-anna-${sfx}`;
  const bo = `u-bo-${sfx}`;
  const cat = `u-cat-${sfx}`;
  const { db, s } = d;
  const ids: Record<string, string> = {};

  await db.insert(s.users).values([
    { id: anna, email: `anna-${sfx}@test.local`, name: "Anna" },
    { id: bo, email: `${sfx}-${LEAK.boEmail}`, name: LEAK.boName },
    { id: cat, email: `cat-${sfx}@test.local`, name: "Cat" },
  ] as never);
  await db.insert(s.organizations).values([
    { id: X, name: "Org X", slug: `x-${sfx}` },
    { id: Y, name: "Org Y", slug: `y-${sfx}` },
  ] as never);
  const mAnnaX = `m-anna-x-${sfx}`;
  const mAnnaY = `m-anna-y-${sfx}`;
  const mBoX = `m-bo-x-${sfx}`;
  await db.insert(s.members).values([
    {
      id: mAnnaX,
      organizationId: X,
      userId: anna,
      role: "member",
      costRate: "777.00",
    },
    { id: mBoX, organizationId: X, userId: bo, role: "owner" },
    { id: mAnnaY, organizationId: Y, userId: anna, role: "member" },
    { id: `m-cat-y-${sfx}`, organizationId: Y, userId: cat, role: "owner" },
  ] as never);

  // Kunder og projekter: organisationens, oprettet af Bo (X) og Cat (Y).
  const [cX, cY] = await db
    .insert(s.clients)
    .values([
      { name: "Kunde X", userId: bo, organizationId: X },
      { name: LEAK.clientY, userId: cat, organizationId: Y },
    ] as never)
    .returning({ id: s.clients.id });
  const [pX, pXunref, pY] = await db
    .insert(s.projects)
    .values([
      { name: "Projekt X", userId: bo, organizationId: X, clientId: cX.id },
      {
        name: LEAK.unrefProject,
        userId: bo,
        organizationId: X,
        clientId: cX.id,
      },
      { name: "Projekt Y", userId: cat, organizationId: Y, clientId: cY.id },
    ] as never)
    .returning({ id: s.projects.id });
  ids.cX = cX.id;
  ids.cY = cY.id;
  ids.pX = pX.id;
  ids.pXunref = pXunref.id;

  const day = new Date("2026-10-01T08:00:00Z");
  const te = (
    userId: string,
    organizationId: string | null,
    note: string,
    project: string,
    client: string,
  ) => ({
    userId,
    organizationId,
    projectId: project,
    clientId: client,
    hours: "1.50",
    billableRate: "654.00",
    date: day,
    description: note,
    notes: note,
  });
  const entries = await db
    .insert(s.timeEntries)
    .values([
      te(anna, X, "anna-x-1", pX.id, cX.id),
      te(anna, X, "anna-x-2", pX.id, cX.id),
      te(bo, X, LEAK.boNote, pX.id, cX.id),
      te(anna, Y, LEAK.yDesc, pY.id, cY.id),
      te(cat, Y, LEAK.catDesc, pY.id, cY.id),
      te(anna, null, "anna-uden-org", pX.id, cX.id),
    ] as never)
    .returning({
      id: s.timeEntries.id,
      description: s.timeEntries.description,
    });
  const byDesc = (desc: string) =>
    entries.find((e) => e.description === desc)!.id;
  ids.teAnna1 = byDesc("anna-x-1");
  ids.teAnna2 = byDesc("anna-x-2");
  ids.teBo = byDesc(LEAK.boNote);
  ids.teAnnaY = byDesc(LEAK.yDesc);
  ids.teAnnaNull = byDesc("anna-uden-org");
  // Pause i Annas og Bos tidsregistrering
  await db.insert(s.timeEntrySegments).values([
    {
      timeEntryId: ids.teAnna1,
      startTime: day,
      endTime: new Date(day.getTime() + 3_600_000),
      durationMinutes: 60,
    },
    {
      timeEntryId: ids.teBo,
      startTime: day,
      endTime: new Date(day.getTime() + 3_600_000),
      durationMinutes: 60,
    },
  ] as never);

  // Opgaver: Annas egen, en Bo har tildelt Anna, en Bo har beholdt, en i org Y
  const tasks = await db
    .insert(s.tasks)
    .values([
      { title: "anna-egen", userId: anna, organizationId: X },
      {
        title: "bo-tildelt-anna",
        userId: bo,
        organizationId: X,
        assignedToUserId: anna,
      },
      { title: LEAK.boDesc, userId: bo, organizationId: X },
      { title: LEAK.yDesc, userId: anna, organizationId: Y },
    ] as never)
    .returning({ id: s.tasks.id, title: s.tasks.title });
  const taskId = (t: string) => tasks.find((x) => x.title === t)!.id;
  ids.tAnna = taskId("anna-egen");
  ids.tAssigned = taskId("bo-tildelt-anna");
  ids.tBo = taskId(LEAK.boDesc);
  ids.tY = taskId(LEAK.yDesc);
  const att = (taskId: string, userId: string, filename: string) => ({
    taskId,
    userId,
    filename,
    contentType: "text/plain",
    sizeBytes: 3,
    content: Buffer.from("abc"),
  });
  const atts = await db
    .insert(s.taskAttachments)
    .values([
      att(ids.tAnna, anna, "anna.txt"),
      att(ids.tAssigned, bo, "bo-paa-annas-opgave.txt"),
      att(ids.tY, anna, "anna-org-y.txt"),
    ] as never)
    .returning({
      id: s.taskAttachments.id,
      filename: s.taskAttachments.filename,
    });
  ids.attAnna = atts.find((a) => a.filename === "anna.txt")!.id;

  // Fravær
  const [absType] = await db
    .insert(s.absenceTypes)
    .values({ organizationId: X, name: "Ferie" } as never)
    .returning({ id: s.absenceTypes.id });
  const abs = await db
    .insert(s.absenceRequests)
    .values([
      {
        organizationId: X,
        userId: anna,
        absenceTypeId: absType.id,
        startDate: "2026-10-05",
        note: "anna-fravaer",
      },
      {
        organizationId: X,
        userId: bo,
        absenceTypeId: absType.id,
        startDate: "2026-10-06",
        note: LEAK.boNote,
      },
    ] as never)
    .returning({ id: s.absenceRequests.id, note: s.absenceRequests.note });
  ids.absAnna = abs.find((a) => a.note === "anna-fravaer")!.id;

  // Timer-hændelser: Annas i X, Annas uden org (som de 78 i prod), Bos
  const evs = await db
    .insert(s.timerEvents)
    .values([
      {
        userId: anna,
        organizationId: X,
        event: "start",
        source: "web",
        detail: { n: "anna-x" },
      },
      {
        userId: anna,
        organizationId: null,
        event: "start",
        source: "web",
        detail: { n: "anna-null" },
      },
      {
        userId: bo,
        organizationId: X,
        event: "start",
        source: "web",
        detail: { n: LEAK.boNote },
      },
    ] as never)
    .returning({ id: s.timerEvents.id, detail: s.timerEvents.detail });
  ids.evAnnaX = evs.find((e) => (e.detail as { n: string }).n === "anna-x")!.id;

  // Timepriser og kundeadgang (keyed på members.id)
  await db.insert(s.memberRates).values([
    { organizationId: X, memberId: mAnnaX, hourlyRate: "500.00" },
    { organizationId: X, memberId: mBoX, hourlyRate: "999.00" },
  ] as never);
  await db.insert(s.memberClientAccess).values([
    { organizationId: X, memberId: mAnnaX, clientId: cX.id },
    { organizationId: X, memberId: mBoX, clientId: cX.id },
  ] as never);

  // Hændelseslog: om Anna, om Bo, om Anna i org Y
  const logs = await db
    .insert(s.orgAuditLogs)
    .values([
      {
        organizationId: X,
        actorId: bo,
        action: "role.changed",
        targetUserId: anna,
        metadata: { n: "om-anna" },
      },
      {
        organizationId: X,
        actorId: anna,
        action: "role.changed",
        targetUserId: bo,
        metadata: { n: LEAK.boNote },
      },
      {
        organizationId: Y,
        actorId: cat,
        action: "role.changed",
        targetUserId: anna,
        metadata: { n: LEAK.yDesc },
      },
    ] as never)
    .returning({ id: s.orgAuditLogs.id, metadata: s.orgAuditLogs.metadata });
  ids.logAnna = logs.find(
    (l) => (l.metadata as { n: string }).n === "om-anna",
  )!.id;

  // Personligt uden organisation
  await db.insert(s.emailFilterRules).values([
    {
      userId: anna,
      ruleType: "sender",
      pattern: "anna@filter.test",
      sourceEmailFrom: LEAK.filterSender,
    },
    { userId: bo, ruleType: "sender", pattern: LEAK.boNote },
  ] as never);

  // Annas egen aktivitetslog: hun har rettet en kunde. Før/efter-værdierne er
  // kundens oplysninger og må ikke med; at hun gjorde det, må gerne.
  const [act] = await db
    .insert(s.activityLogs)
    .values({
      userId: anna,
      organizationId: X,
      entityType: "client",
      entityId: cX.id,
      action: "update",
      entityName: "Kunde X",
      changes: [
        {
          field: "email",
          fieldLabel: "E-mail",
          before: LEAK.customerBefore,
          after: LEAK.customerAfter,
        },
      ],
      metadata: { n: LEAK.activityMeta },
    } as never)
    .returning({ id: s.activityLogs.id });
  ids.actAnna = act.id;

  // Annas fakturamail til en kunde: user_id er afsenderen, `to` er kunden
  await db.insert(s.emailDeliveryLogs).values({
    to: LEAK.deliveryTo,
    subject: "Faktura til kunden",
    templateType: "invoice",
    status: "sent",
    userId: anna,
  } as never);

  return { X, Y, anna, bo, cat, ids };
}

describe.skipIf(!ENABLED)("bruger-eksport mod rigtig Postgres", () => {
  beforeAll(async () => {
    d = {
      db: (await import("@/lib/db")).db,
      s: await import("@/lib/db/schema"),
      collect: await import("../user-collect"),
      zip: await import("../zip"),
      job: await import("../job"),
    };
    w = await seed();
  }, 60_000);

  it("Anna i org X får præcis sine egne rækker", async () => {
    const c = await d.collect.collectUserExport(d.db, {
      orgId: w.X,
      userId: w.anna,
    });
    expect(idsOf(c, "timeEntries")).toEqual(
      [w.ids.teAnna1, w.ids.teAnna2].sort(),
    );
    expect(idsOf(c, "timeEntrySegments")).toHaveLength(1);
    // Opgaver: hendes egen og den, Bo har tildelt hende. Ikke Bos egen.
    expect(idsOf(c, "tasks")).toEqual([w.ids.tAnna, w.ids.tAssigned].sort());
    // Vedhæftninger kun hendes egne, også på den tildelte opgave
    expect(idsOf(c, "taskAttachments")).toEqual([w.ids.attAnna]);
    expect(idsOf(c, "absenceRequests")).toEqual([w.ids.absAnna]);
    expect(idsOf(c, "timerEvents")).toEqual([w.ids.evAnnaX]);
    expect(idsOf(c, "orgAuditLogs")).toEqual([w.ids.logAnna]);
    expect(rowsOf(c, "members")).toHaveLength(1);
    // Timepriser er organisationens forretningsdata: Anna er medarbejder
    expect(rowsOf(c, "memberRates")).toHaveLength(0);
    expect(rowsOf(c, "timeEntries")[0]).not.toHaveProperty("billableRate");
    expect(rowsOf(c, "users")[0]).not.toHaveProperty("defaultHourlyRate");
    expect(rowsOf(c, "memberClientAccess")).toHaveLength(1);
    // Hendes egen aktivitetslog er med, men uden kundens før/efter-værdier
    expect(idsOf(c, "activityLogs")).toEqual([w.ids.actAnna]);
    expect(rowsOf(c, "activityLogs")[0]).not.toHaveProperty("changes");
    expect(rowsOf(c, "activityLogs")[0]).not.toHaveProperty("metadata");
    // Mailfiltre og leveringslog er udeladt (kunders adresser på tværs af orgs)
    expect(c.some((t) => t.entry.key === "emailFilterRules")).toBe(false);
    expect(c.some((t) => t.entry.key === "emailDeliveryLogs")).toBe(false);
    expect(rowsOf(c, "users")).toHaveLength(1);
    expect(rowsOf(c, "users")[0].id).toBe(w.anna);
    expect(rowsOf(c, "organizations")[0].id).toBe(w.X);
  });

  it("intet fra Bo, Cat eller org Y findes nogen steder i Annas eksport", async () => {
    const c = await d.collect.collectUserExport(d.db, {
      orgId: w.X,
      userId: w.anna,
    });
    const all = JSON.stringify(c.map((t) => t.rows));
    for (const [name, secret] of Object.entries(LEAK)) {
      expect(all.includes(secret), `lækket: ${name}`).toBe(false);
    }
    // Bos id og e-mail er heller ikke med (Anna ser kun sit eget id og andres id'er i kolonner).
    expect(all.includes(w.cat)).toBe(false);
    expect(all.includes(w.Y)).toBe(false);
    // Intern omkostningssats, timepriser og Bos timepris
    expect(all.includes("777.00")).toBe(false);
    expect(all.includes("999.00")).toBe(false);
    expect(all.includes("500.00")).toBe(false);
    expect(all.includes("654.00")).toBe(false);
    expect(rowsOf(c, "members")[0]).not.toHaveProperty("costRate");
  });

  it("opslag har kun navn på de kunder og projekter, Annas rækker peger på", async () => {
    const c = await d.collect.collectUserExport(d.db, {
      orgId: w.X,
      userId: w.anna,
    });
    expect(rowsOf(c, "projects").map((r) => r.name)).toEqual(["Projekt X"]);
    expect(rowsOf(c, "clients").map((r) => r.name)).toEqual(["Kunde X"]);
    // Opslagene har kun id (+ navn/forældre-id), ikke mail, telefon, satser
    expect(Object.keys(rowsOf(c, "clients")[0]).sort()).toEqual(["id", "name"]);
    expect(Object.keys(rowsOf(c, "projects")[0]).sort()).toEqual([
      "clientId",
      "id",
      "name",
    ]);
    expect(rowsOf(c, "absenceTypes").map((r) => r.name)).toEqual(["Ferie"]);
  });

  it("Anna i org Y får kun rækkerne dér", async () => {
    const c = await d.collect.collectUserExport(d.db, {
      orgId: w.Y,
      userId: w.anna,
    });
    expect(idsOf(c, "timeEntries")).toEqual([w.ids.teAnnaY]);
    expect(idsOf(c, "tasks")).toEqual([w.ids.tY]);
    expect(rowsOf(c, "absenceRequests")).toHaveLength(0);
    const all = JSON.stringify(c.map((t) => t.rows));
    expect(all.includes("anna-x-1")).toBe(false);
    expect(all.includes("Kunde X")).toBe(false);
    expect(all.includes(LEAK.catDesc)).toBe(false);
    expect(rowsOf(c, "organizations")[0].id).toBe(w.Y);
  });

  it("kollegaen Bo får sine egne rækker og ingen af Annas", async () => {
    const c = await d.collect.collectUserExport(d.db, {
      orgId: w.X,
      userId: w.bo,
    });
    expect(idsOf(c, "timeEntries")).toEqual([w.ids.teBo]);
    expect(rowsOf(c, "users")[0].id).toBe(w.bo);
    // Bo er ejer: hans egne timepriser er med
    expect(rowsOf(c, "memberRates").map((r) => r.hourlyRate)).toEqual([
      "999.00",
    ]);
    expect(rowsOf(c, "timeEntries")[0].billableRate).toBe("654.00");
    const all = JSON.stringify(c.map((t) => t.rows));
    expect(all.includes("anna-x-1")).toBe(false);
    expect(all.includes("anna@filter.test")).toBe(false);
  });

  it("uden organisation: kun rækker uden organisation, ikke rækker fra en org man er medlem af", async () => {
    const c = await d.collect.collectUserExport(d.db, {
      orgId: null,
      userId: w.anna,
    });
    expect(idsOf(c, "timeEntries")).toEqual([w.ids.teAnnaNull]);
    expect(rowsOf(c, "members")).toHaveLength(0);
    expect(rowsOf(c, "timerEvents")).toHaveLength(1);
    expect(rowsOf(c, "organizations")).toHaveLength(0);
  });

  it("en bruger, der ikke er medlem af org'en, kan ikke få en eksport derfra", async () => {
    await expect(
      d.collect.collectUserExport(d.db, { orgId: w.X, userId: w.cat }),
    ).rejects.toThrow(/medlem/);
  });

  it("ZIP'en: README, data.json og csv har kun Annas data, og ingen lækager", async () => {
    const { zip } = await collectZip((out) =>
      d.zip.generateUserExportZip(d.db, { orgId: w.X, userId: w.anna }, out),
    );
    const files = unzipSync(zip);
    const names = Object.keys(files);
    expect(names).toContain("README.txt");
    expect(names).toContain("data.json");
    expect(names).toContain("csv/tidsregistreringer.csv");
    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain("dine egne data");
    expect(readme).toContain('"Org X"');
    expect(readme).not.toContain("alle data for organisationen");
    const json = JSON.parse(strFromU8(files["data.json"]));
    expect(json.metadata.format).toBe("timetrack-user-export");
    expect(json.tables.tidsregistreringer).toHaveLength(2);
    // Ingen fil i ZIP'en indeholder andres data
    for (const [name, bytes] of Object.entries(files)) {
      const text = strFromU8(bytes);
      for (const [k, secret] of Object.entries(LEAK)) {
        expect(text.includes(secret), `${name} indeholder ${k}`).toBe(false);
      }
    }
    // Binært indhold i rækkerne (vedhæftning) er med som fil
    expect(
      names.some((n) => n.startsWith("filer/opgave-vedhaeftninger/")),
    ).toBe(true);
  });

  it("baggrundsjobbet bygger en user_full-eksport for Anna og lader den gamle eksport være", async () => {
    const { s, db } = d;
    const [req] = await db
      .insert(s.dataExportRequests)
      .values({
        userId: w.anna,
        organizationId: w.X,
        requestType: "user_full",
        format: "zip",
        downloadTokenHash: `h-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      } as never)
      .returning({ id: s.dataExportRequests.id });
    // En ventende gammel (gdpr_full) må jobbet ikke røre
    const [legacy] = await db
      .insert(s.dataExportRequests)
      .values({
        userId: w.anna,
        requestType: "gdpr_full",
        format: "json",
        downloadTokenHash: `h-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      } as never)
      .returning({ id: s.dataExportRequests.id });

    const res = await d.job.processOrgExports(db);
    expect(res.failed, res.errors.join("; ")).toBe(0);
    const { eq } = await import("drizzle-orm");
    const after = await db.query.dataExportRequests.findFirst({
      where: eq(s.dataExportRequests.id, req.id),
    });
    expect(after?.status).toBe("ready");
    expect(after?.fileSizeBytes ?? 0).toBeGreaterThan(0);
    const legacyAfter = await db.query.dataExportRequests.findFirst({
      where: eq(s.dataExportRequests.id, legacy.id),
    });
    expect(legacyAfter?.status).toBe("pending");
  }, 60_000);

  it("en bruger-eksport, hvor brugeren er gået ud af organisationen, fejler i jobbet", async () => {
    const { s, db } = d;
    const [req] = await db
      .insert(s.dataExportRequests)
      .values({
        userId: w.cat,
        organizationId: w.X,
        requestType: "user_full",
        format: "zip",
        downloadTokenHash: `h-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      } as never)
      .returning({ id: s.dataExportRequests.id });
    const res = await d.job.processOrgExports(db);
    expect(res.failed).toBe(1);
    const { eq } = await import("drizzle-orm");
    const after = await db.query.dataExportRequests.findFirst({
      where: eq(s.dataExportRequests.id, req.id),
    });
    expect(after?.status).toBe("failed");
  }, 60_000);
});
