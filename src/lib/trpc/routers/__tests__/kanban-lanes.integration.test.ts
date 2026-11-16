/**
 * INTEGRATION: egne kanban-kolonner (task_statuses) med kategori.
 *
 * Dækker det, en mock ikke kan se troværdigt: at kolonnens kategori
 * skriver den rigtige tasks.status/completedAt i databasen, at kortenes
 * rækkefølge gemmes og læses tilbage af tavlen, at tavlen placerer opgaver
 * efter omdøbning og statusændringer andre steder, og at alt er afgrænset
 * til egen organisation og kræver skriveadgang til opgavemodulet.
 *
 * Kører mod en rigtig Postgres med et klonet, minimalt schema i en
 * scratch-schema (som user-startpage.integration.test.ts). Kun med
 * TEST_DATABASE_URL sat.
 */

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

// tasks-routeren bruger det globale db-modul; peg det på testens database.
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("@/lib/db/index", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
const webhook = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: webhook.emit }));
vi.mock("@/lib/notifications/push", () => ({ pushToUser: vi.fn() }));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));

import * as schema from "@/lib/db/schema";
import {
  members,
  organizations,
  rolePermissions,
  subscriptions,
  taskStatuses,
  tasks,
  users,
} from "@/lib/db/schema";
import { taskStatusesRouter } from "../taskStatuses";
import { tasksRouter } from "../tasks";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const CLONED = [
  "user",
  "organizations",
  "members",
  "organization_modules",
  "role_permissions",
  "employee_profiles",
  "feature_flags",
  "subscriptions",
  "clients",
  "projects",
  "task_statuses",
  "tasks",
  "time_entries",
];

const ORG_A = "org-kanban-a";
const ORG_B = "org-kanban-b";
const OWNER_A = "user-kanban-owner-a";
const MEMBER_A = "user-kanban-member-a";
const OWNER_B = "user-kanban-owner-b";

describe.skipIf(!TEST_DATABASE_URL)(
  "egne kanban-kolonner (integration)",
  () => {
    const scratch = `kanban_lanes_it_${Date.now()}`;
    const admin = testPostgres({
      max: 1,
      onnotice: () => {},
    });
    const client = testPostgres({
      max: 1,
      onnotice: () => {},
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });
    holder.db = db;

    const ctx = (userId: string) =>
      ({
        db,
        headers: new Headers(),
        session: { user: { id: userId } },
        orgOverride: null,
      }) as never;
    const lanesFor = (userId: string) =>
      taskStatusesRouter.createCaller(ctx(userId));
    const tasksFor = (userId: string) => tasksRouter.createCaller(ctx(userId));

    async function lanesOf(userId: string) {
      return lanesFor(userId).listForContext({ projectId: null });
    }
    async function laneId(userId: string, name: string) {
      const lane = (await lanesOf(userId)).find((l) => l.name === name);
      if (!lane) throw new Error(`kolonnen ${name} findes ikke`);
      return lane.id;
    }
    async function taskRow(id: string) {
      const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
      return row;
    }
    async function newTask(userId: string, title: string, statusId?: string) {
      return tasksFor(userId).create({
        title,
        status: "backlog",
        priority: "medium",
        sourceType: "manual",
        statusId,
      });
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of CLONED) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      // Kolonnenavne er unikke pr. tavle i prod (migrate-safe).
      await admin.unsafe(
        `CREATE UNIQUE INDEX ON ${scratch}."task_statuses" ("organization_id", "scope", COALESCE("project_id", '00000000-0000-0000-0000-000000000000'), "name")`,
      );

      await db.insert(users).values([
        { id: OWNER_A, email: "a-ejer@test.dk", name: "A Ejer" },
        { id: MEMBER_A, email: "a-medlem@test.dk", name: "A Medlem" },
        { id: OWNER_B, email: "b-ejer@test.dk", name: "B Ejer" },
      ]);
      await db.insert(organizations).values([
        { id: ORG_A, name: "Org A", slug: "kanban-org-a" },
        { id: ORG_B, name: "Org B", slug: "kanban-org-b" },
      ]);
      await db.insert(members).values([
        {
          id: "m-a-owner",
          organizationId: ORG_A,
          userId: OWNER_A,
          role: "owner",
        },
        {
          id: "m-a-member",
          organizationId: ORG_A,
          userId: MEMBER_A,
          role: "member",
        },
        {
          id: "m-b-owner",
          organizationId: ORG_B,
          userId: OWNER_B,
          role: "owner",
        },
      ]);
      const trialEndsAt = new Date(Date.now() + 30 * 86400000);
      await db.insert(subscriptions).values([
        {
          userId: OWNER_A,
          organizationId: ORG_A,
          billingCycle: "monthly",
          status: "trialing",
          trialEndsAt,
        },
        {
          userId: OWNER_B,
          organizationId: ORG_B,
          billingCycle: "monthly",
          status: "trialing",
          trialEndsAt,
        },
      ]);
      // Medlemmer i org A må kun læse opgaver.
      await db.insert(rolePermissions).values({
        organizationId: ORG_A,
        roleName: "member",
        moduleKey: "tasks",
        accessLevel: "read",
      });
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("første opslag giver de fire standardkolonner med deres kategori", async () => {
      const lanes = await lanesOf(OWNER_A);
      expect(lanes.map((l) => [l.name, l.category])).toEqual([
        ["Backlog", "not_started"],
        ["Todo", "not_started"],
        ["I gang", "in_progress"],
        ["Afsluttet", "done"],
      ]);
      // Gentaget opslag opretter ikke dubletter.
      expect(await lanesOf(OWNER_A)).toHaveLength(4);
    });

    it("tavlen viser opgaverne allerede ved første besøg", async () => {
      // Org B har ingen kolonner endnu; opgaven er oprettet uden statusId
      // (som fra desktop eller mail-til-opgave).
      await db.insert(tasks).values({
        userId: OWNER_B,
        organizationId: ORG_B,
        title: "Fra desktop",
        status: "in_progress",
      });
      const grouped = await tasksFor(OWNER_B).listByStatus();
      const igang = await laneId(OWNER_B, "I gang");
      expect(grouped[igang]?.map((t) => t.title)).toEqual(["Fra desktop"]);
    });

    it("en egen kolonne med kategorien afsluttet lukker opgaven, og en ikke-startet genåbner den", async () => {
      const fakt = await lanesFor(OWNER_A).create({
        projectId: null,
        name: "Faktureres",
        color: "#10b981",
        category: "done",
      });
      const tilbud = await lanesFor(OWNER_A).create({
        projectId: null,
        name: "Tilbud",
        color: "#f59e0b",
        category: "not_started",
      });
      const task = await newTask(
        OWNER_A,
        "Logo",
        await laneId(OWNER_A, "I gang"),
      );
      expect((await taskRow(task.id)).status).toBe("in_progress");

      webhook.emit.mockClear();
      await tasksFor(OWNER_A).move({ taskId: task.id, statusId: fakt.id });
      let row = await taskRow(task.id);
      expect(row.statusId).toBe(fakt.id);
      expect(row.status).toBe("done");
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(webhook.emit).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "task.completed" }),
      );

      await tasksFor(OWNER_A).move({ taskId: task.id, statusId: tilbud.id });
      row = await taskRow(task.id);
      expect(row.status).toBe("todo");
      expect(row.completedAt).toBeNull();
    });

    it("ny kategori på en kolonne ændrer status på opgaverne i den", async () => {
      const lane = await lanesFor(OWNER_A).create({
        projectId: null,
        name: "Afventer korrektur",
        color: "#8b5cf6",
      });
      expect(lane.category).toBe("not_started");
      const task = await newTask(OWNER_A, "Folder", lane.id);
      expect((await taskRow(task.id)).status).toBe("backlog");

      await lanesFor(OWNER_A).update({ id: lane.id, category: "in_progress" });
      expect((await taskRow(task.id)).status).toBe("in_progress");

      await lanesFor(OWNER_A).update({ id: lane.id, category: "done" });
      let row = await taskRow(task.id);
      expect(row.status).toBe("done");
      expect(row.completedAt).toBeInstanceOf(Date);

      // Annulleret er lukket, men ikke afsluttet.
      await lanesFor(OWNER_A).update({ id: lane.id, category: "cancelled" });
      row = await taskRow(task.id);
      expect(row.status).toBe("done");
      expect(row.completedAt).toBeNull();
    });

    it("en annulleret opgave tæller ikke som afsluttet", async () => {
      const annulleret = await lanesFor(OWNER_A).create({
        projectId: null,
        name: "Annulleret",
        color: "#6b7280",
        category: "cancelled",
      });
      const task = await newTask(
        OWNER_A,
        "Droppet",
        await laneId(OWNER_A, "I gang"),
      );
      const before = await tasksFor(OWNER_A).getStats();

      webhook.emit.mockClear();
      await tasksFor(OWNER_A).move({
        taskId: task.id,
        statusId: annulleret.id,
      });
      let row = await taskRow(task.id);
      expect(row.status).toBe("done");
      expect(row.completedAt).toBeNull();
      expect(webhook.emit).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "task.completed" }),
      );
      const stats = await tasksFor(OWNER_A).getStats();
      expect(stats.done).toBe(before.done);
      expect(stats.cancelled).toBe(before.cancelled + 1);
      expect(stats.inProgress).toBe(before.inProgress - 1);

      // Fra annulleret til afsluttet er en afslutning.
      await tasksFor(OWNER_A).move({
        taskId: task.id,
        statusId: await laneId(OWNER_A, "Afsluttet"),
      });
      row = await taskRow(task.id);
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(webhook.emit).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "task.completed" }),
      );
      expect((await tasksFor(OWNER_A).getStats()).done).toBe(before.done + 1);
    });

    it("gemmer kortenes rækkefølge, og tavlen læser den tilbage", async () => {
      const todo = await laneId(OWNER_A, "Todo");
      const a = await newTask(OWNER_A, "A", todo);
      const b = await newTask(OWNER_A, "B", todo);
      const c = await newTask(OWNER_A, "C", todo);

      await tasksFor(OWNER_A).move({
        taskId: c.id,
        statusId: todo,
        orderedTaskIds: [c.id, a.id, b.id],
      });
      let grouped = await tasksFor(OWNER_A).listByStatus();
      expect(grouped[todo]?.map((t) => t.title)).toEqual(["C", "A", "B"]);

      // Flyt et kort ind fra en anden kolonne på en bestemt plads.
      const igang = await laneId(OWNER_A, "I gang");
      const d = await newTask(OWNER_A, "D", igang);
      await tasksFor(OWNER_A).move({
        taskId: d.id,
        statusId: todo,
        orderedTaskIds: [c.id, d.id, a.id, b.id],
      });
      grouped = await tasksFor(OWNER_A).listByStatus();
      expect(grouped[todo]?.map((t) => t.title)).toEqual(["C", "D", "A", "B"]);
      expect((await taskRow(d.id)).status).toBe("todo");
    });

    it("afviser en rækkefølge uden kortet eller med dubletter", async () => {
      const todo = await laneId(OWNER_A, "Todo");
      const a = await newTask(OWNER_A, "Rækkefølge", todo);
      await expect(
        tasksFor(OWNER_A).move({
          taskId: a.id,
          statusId: todo,
          orderedTaskIds: [],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        tasksFor(OWNER_A).move({
          taskId: a.id,
          statusId: todo,
          orderedTaskIds: [a.id, a.id],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("opgaver forsvinder ikke, når Backlog omdøbes, eller status ændres andetsteds", async () => {
      const backlog = await laneId(OWNER_A, "Backlog");
      await lanesFor(OWNER_A).update({ id: backlog, name: "Ikke startet" });
      const [legacy] = await db
        .insert(tasks)
        .values({
          userId: OWNER_A,
          organizationId: ORG_A,
          title: "Gammel backlog",
          status: "backlog",
        })
        .returning();

      let grouped = await tasksFor(OWNER_A).listByStatus();
      expect(grouped[backlog]?.some((t) => t.id === legacy.id)).toBe(true);

      // Desktop/listen markerer opgaven færdig via den gamle status.
      await tasksFor(OWNER_A).markDone({ id: legacy.id });
      grouped = await tasksFor(OWNER_A).listByStatus();
      const afsluttet = await laneId(OWNER_A, "Afsluttet");
      expect(grouped[afsluttet]?.some((t) => t.id === legacy.id)).toBe(true);
      expect((grouped[backlog] ?? []).some((t) => t.id === legacy.id)).toBe(
        false,
      );
    });

    it("dublerede kolonnenavne giver en læsbar fejl", async () => {
      await expect(
        lanesFor(OWNER_A).create({
          projectId: null,
          name: "Todo",
          color: "#3b82f6",
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Der findes allerede en kolonne med det navn",
      });
    });

    it("ny kategori og sletning tager også de kort med, tavlen kun viser i kolonnen", async () => {
      // Oprettet uden statusId (formularen, desktop): tavlen viser den i Todo.
      const [loose] = await db
        .insert(tasks)
        .values({
          userId: OWNER_B,
          organizationId: ORG_B,
          title: "Uden kolonne",
          status: "todo",
        })
        .returning();
      const todo = await laneId(OWNER_B, "Todo");
      let grouped = await tasksFor(OWNER_B).listByStatus();
      expect(grouped[todo]?.some((t) => t.id === loose.id)).toBe(true);

      await lanesFor(OWNER_B).update({ id: todo, category: "done" });
      let row = await taskRow(loose.id);
      expect(row.statusId).toBe(todo);
      expect(row.status).toBe("done");
      expect(row.completedAt).toBeInstanceOf(Date);
      grouped = await tasksFor(OWNER_B).listByStatus();
      expect(grouped[todo]?.some((t) => t.id === loose.id)).toBe(true);

      // Sletning med modtager flytter også de løse kort derhen.
      const [inProgress] = await db
        .insert(tasks)
        .values({
          userId: OWNER_B,
          organizationId: ORG_B,
          title: "Løs i gang",
          status: "in_progress",
        })
        .returning();
      const backlog = await laneId(OWNER_B, "Backlog");
      await lanesFor(OWNER_B).delete({
        id: await laneId(OWNER_B, "I gang"),
        destinationLaneId: backlog,
      });
      row = await taskRow(inProgress.id);
      expect(row.statusId).toBe(backlog);
      expect(row.status).toBe("backlog");
    });

    it("sletning flytter opgaverne og giver dem modtagerens status; den sidste kolonne kan ikke slettes", async () => {
      const lane = await lanesFor(OWNER_A).create({
        projectId: null,
        name: "Slettes",
        color: "#ef4444",
        category: "in_progress",
      });
      const task = await newTask(OWNER_A, "Flyttes", lane.id);
      const afsluttet = await laneId(OWNER_A, "Afsluttet");
      await lanesFor(OWNER_A).delete({
        id: lane.id,
        destinationLaneId: afsluttet,
      });
      const row = await taskRow(task.id);
      expect(row.statusId).toBe(afsluttet);
      expect(row.status).toBe("done");

      // Org B: slet ned til én kolonne.
      const bLanes = await lanesOf(OWNER_B);
      const keep = bLanes[0];
      for (const l of bLanes.slice(1)) {
        await lanesFor(OWNER_B).delete({
          id: l.id,
          destinationLaneId: keep.id,
        });
      }
      await expect(
        lanesFor(OWNER_B).delete({ id: keep.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    describe("rettigheder", () => {
      it("en anden organisation kan ikke se, rette, sortere eller slette kolonnerne", async () => {
        const aLanes = await lanesOf(OWNER_A);
        const bLanes = await lanesOf(OWNER_B);
        expect(bLanes.some((l) => aLanes.some((a) => a.id === l.id))).toBe(
          false,
        );
        const target = aLanes[0].id;
        await expect(
          lanesFor(OWNER_B).update({ id: target, name: "Hacket" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          lanesFor(OWNER_B).update({ id: target, category: "done" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          lanesFor(OWNER_B).reorder({ orderedIds: aLanes.map((l) => l.id) }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          lanesFor(OWNER_B).delete({ id: target }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const [after] = await db
          .select()
          .from(taskStatuses)
          .where(eq(taskStatuses.id, target));
        expect(after.name).toBe(aLanes[0].name);
      });

      it("en anden organisation kan ikke flytte eller sortere opgaverne", async () => {
        const todoA = await laneId(OWNER_A, "Todo");
        const aTask = await newTask(OWNER_A, "Hemmelig", todoA);
        const bLane = (await lanesOf(OWNER_B))[0].id;
        const [bTask] = await db
          .insert(tasks)
          .values({
            userId: OWNER_B,
            organizationId: ORG_B,
            title: "B's egen",
            status: "todo",
          })
          .returning();

        // B flytter A's opgave ind i sin egen kolonne.
        await expect(
          tasksFor(OWNER_B).move({ taskId: aTask.id, statusId: bLane }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        // B flytter sin egen opgave ind i A's kolonne.
        await expect(
          tasksFor(OWNER_B).move({ taskId: bTask.id, statusId: todoA }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        // B sorterer A's opgave via rækkefølgen.
        const before = (await taskRow(aTask.id)).position;
        await expect(
          tasksFor(OWNER_B).move({
            taskId: bTask.id,
            statusId: bLane,
            orderedTaskIds: [aTask.id, bTask.id],
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect((await taskRow(aTask.id)).position).toBe(before);
        expect((await taskRow(aTask.id)).statusId).toBe(todoA);
      });

      it("et medlem med læseadgang kan se tavlen men ikke ændre den", async () => {
        const lanes = await lanesOf(MEMBER_A);
        expect(lanes.length).toBeGreaterThan(0);
        const task = (await tasksFor(OWNER_A).listByStatus())[lanes[0].id]?.[0];
        await expect(
          lanesFor(MEMBER_A).create({
            projectId: null,
            name: "Medlem",
            color: "#000000",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          lanesFor(MEMBER_A).update({ id: lanes[0].id, category: "done" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        if (task) {
          await expect(
            tasksFor(MEMBER_A).move({ taskId: task.id, statusId: lanes[1].id }),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
        }
        const [unchanged] = await db
          .select({ category: taskStatuses.category })
          .from(taskStatuses)
          .where(
            and(
              eq(taskStatuses.id, lanes[0].id),
              eq(taskStatuses.organizationId, ORG_A),
            ),
          );
        expect(unchanged.category).toBe(lanes[0].category);
      });
    });
  },
);
