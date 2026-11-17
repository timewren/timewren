/**
 * Timeren hører til den organisation, den startes i: web-sync, extensionens
 * updateTimerState og quickStart sætter `timer_states.organization_id`, så
 * team-live kun viser timeren i den org (team.liveTimers).
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

const ENABLED = process.env.TT_DB_TESTS === "1";

type Deps = {
  world: typeof import("./world");
  db: typeof import("@/lib/db").db;
  schema: typeof import("@/lib/db/schema");
};
let d: Deps;

/** Gør fixturens bruger til medlem af en org B med egen kunde og projekt. */
async function seedSecondOrg(userId: string) {
  const { db, schema } = d;
  const orgB = `model-org-b-${randomUUID()}`;
  await db
    .insert(schema.organizations)
    .values({ id: orgB, name: "Model Org B", slug: orgB } as never);
  await db.insert(schema.members).values({
    id: `model-member-b-${randomUUID()}`,
    organizationId: orgB,
    userId,
    role: "member",
  } as never);
  const [client] = await db
    .insert(schema.clients)
    .values({ name: "Kunde i B", userId, organizationId: orgB } as never)
    .returning({ id: schema.clients.id });
  const [project] = await db
    .insert(schema.projects)
    .values({
      name: "Projekt i B",
      userId,
      organizationId: orgB,
      clientId: client.id,
    } as never)
    .returning({ id: schema.projects.id });
  return { orgB, clientId: client.id, projectId: project.id };
}

describe.skipIf(!ENABLED)(
  "timer_states.organization_id sættes ved start",
  () => {
    beforeAll(async () => {
      d = {
        world: await import("./world"),
        db: (await import("@/lib/db")).db,
        schema: await import("@/lib/db/schema"),
      };
    });

    it("web-sync sætter orgen", async () => {
      const fx = await d.world.seedFixture();
      const now = Date.now();

      const res = await d.world.sessionCaller(fx).timerSync.sync({
        isRunning: true,
        startTime: now,
        sessionStartTime: now,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.A.projectId,
        clientId: fx.targets.A.clientId,
        taskId: null,
        description: "",
        source: "web",
        isFreshStart: true,
      });

      expect(res.success).toBe(true);
      const row = await d.world.readTimerRow(fx.userId);
      expect(row?.organizationId).toBe(fx.orgId);
    });

    it("extensionens updateTimerState sætter orgen", async () => {
      const fx = await d.world.seedFixture();

      await d.world.tokenCaller().extension.updateTimerState({
        token: fx.token,
        isRunning: true,
        startTime: new Date().toISOString(),
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.A.projectId,
        clientId: fx.targets.A.clientId,
        description: "",
        source: "extension",
        isFreshStart: true,
      });

      const row = await d.world.readTimerRow(fx.userId);
      expect(row?.isRunning).toBe(true);
      expect(row?.organizationId).toBe(fx.orgId);
    });

    it("extensionens quickStart sætter orgen", async () => {
      const fx = await d.world.seedFixture();

      await d.world.tokenCaller().extension.quickStart({ token: fx.token });

      const row = await d.world.readTimerRow(fx.userId);
      expect(row?.isRunning).toBe(true);
      expect(row?.organizationId).toBe(fx.orgId);
    });

    it("en delvis skrivning fra en anden org ommærker ikke timeren", async () => {
      const fx = await d.world.seedFixture();
      const b = await seedSecondOrg(fx.userId);
      const caller = d.world.tokenCaller();

      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: fx.orgId,
        isRunning: true,
        startTime: new Date().toISOString(),
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.A.projectId,
        clientId: fx.targets.A.clientId,
        description: "Arbejde i A",
        source: "extension",
        isFreshStart: true,
      });

      // Kun kunden ryddes; projekt og beskrivelse fra A bevares.
      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: b.orgB,
        clientId: null,
        source: "extension",
      });
      // Et genoptag fra B uden nye detaljer.
      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: b.orgB,
        isRunning: true,
        source: "extension",
      });

      const row = await d.world.readTimerRow(fx.userId);
      expect(row?.projectId).toBe(fx.targets.A.projectId);
      expect(row?.description).toBe("Arbejde i A");
      expect(row?.organizationId).toBe(fx.orgId);
    });

    it("en blandet tilstand hører ikke til nogen af orgene", async () => {
      const fx = await d.world.seedFixture();
      const b = await seedSecondOrg(fx.userId);
      const caller = d.world.tokenCaller();

      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: fx.orgId,
        isRunning: true,
        startTime: new Date().toISOString(),
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.A.projectId,
        clientId: fx.targets.A.clientId,
        description: "Arbejde i A",
        source: "extension",
        isFreshStart: true,
      });

      // B's projekt og kunde, men A's beskrivelse bevares.
      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: b.orgB,
        projectId: b.projectId,
        clientId: b.clientId,
        source: "extension",
      });

      const row = await d.world.readTimerRow(fx.userId);
      expect(row?.projectId).toBe(b.projectId);
      expect(row?.description).toBe("Arbejde i A");
      expect(row?.organizationId).toBeNull();
    });

    it("afgør orgen ud fra rækken, som den står ved skrivningen", async () => {
      const fx = await d.world.seedFixture();
      const b = await seedSecondOrg(fx.userId);
      const caller = d.world.tokenCaller();

      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: fx.orgId,
        isRunning: true,
        startTime: new Date().toISOString(),
        elapsedSeconds: 0,
        baseSeconds: 0,
        source: "extension",
        isFreshStart: true,
      });

      // Et A-kald lander mellem B-kaldets læsning og dets upsert.
      const { timerStates } = d.schema;
      const { eq } = await import("drizzle-orm");
      const original = d.db.transaction.bind(d.db);
      const spy = vi.spyOn(d.db, "transaction").mockImplementationOnce((async (
        ...args: unknown[]
      ) => {
        await d.db
          .update(timerStates)
          .set({
            projectId: fx.targets.A.projectId,
            description: "Arbejde i A",
          })
          .where(eq(timerStates.userId, fx.userId));
        return (original as (...a: unknown[]) => unknown)(...args);
      }) as never);
      try {
        await caller.extension.updateTimerState({
          token: fx.token,
          organizationId: b.orgB,
          clientId: null,
          source: "extension",
        });
      } finally {
        spy.mockRestore();
      }

      const row = await d.world.readTimerRow(fx.userId);
      expect(row?.projectId).toBe(fx.targets.A.projectId);
      expect(row?.organizationId).toBe(fx.orgId);
    });

    it("et fuldt skift til den anden orgs projekt flytter timeren", async () => {
      const fx = await d.world.seedFixture();
      const b = await seedSecondOrg(fx.userId);
      const caller = d.world.tokenCaller();

      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: fx.orgId,
        isRunning: true,
        startTime: new Date().toISOString(),
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.A.projectId,
        clientId: fx.targets.A.clientId,
        description: "Arbejde i A",
        source: "extension",
        isFreshStart: true,
      });

      await caller.extension.updateTimerState({
        token: fx.token,
        organizationId: b.orgB,
        projectId: b.projectId,
        clientId: b.clientId,
        description: "Arbejde i B",
        source: "extension",
      });

      const row = await d.world.readTimerRow(fx.userId);
      expect(row?.projectId).toBe(b.projectId);
      expect(row?.organizationId).toBe(b.orgB);
    });
  },
);
