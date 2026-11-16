/**
 * extension.tasks.*: liste, opret, status og tid på opgave via token — med
 * web's modul-vagt og org-isolation.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { organizationModules, tasks } from "@/lib/db/schema";
import { MODULE_KEYS } from "@/lib/modules/constants";
import { deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

describe.skipIf(!enabled)("extension.tasks (token-API)", () => {
  it("opret, skift status, registrér tid og se den på opgaven", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Opgavekunde" },
    });
    const project = await api.projects.create({
      token: acc.token,
      data: { name: "Opgaveprojekt", clientId: client.id },
    });

    const task = await api.tasks.create({
      token: acc.token,
      data: { title: "Skriv tilbud", projectId: project.id },
    });
    expect(task.organizationId).toBe(acc.orgId);

    await api.tasks.setStatus({
      token: acc.token,
      id: task.id,
      status: "in_progress",
    });
    let row = await db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
    expect(row?.status).toBe("in_progress");

    const clientEntryId = randomUUID();
    const logTime = () =>
      api.tasks.logTime({
        token: acc.token,
        id: task.id,
        data: {
          projectId: project.id,
          description: "Tilbud",
          hours: 1.5,
          date: "2026-10-20",
          clientEntryId,
        },
      });
    const first = await logTime();
    // Offline-køen gentager kaldet: samme post, ingen dublet.
    const again = await logTime();
    expect(again.id).toBe(first.id);

    const entries = await api.tasks.timeEntries({
      token: acc.token,
      id: task.id,
    });
    expect(entries.entries.map((e) => e.id)).toEqual([first.id]);

    const list = await api.tasks.list({ token: acc.token });
    expect(list.find((t) => t.id === task.id)?.trackedMinutes).toBe(90);

    await api.tasks.setStatus({
      token: acc.token,
      id: task.id,
      status: "done",
    });
    row = await db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
    expect(row?.status).toBe("done");
    await api.tasks.reopen({ token: acc.token, id: task.id });
    row = await db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
    expect(row?.status).not.toBe("done");
  });

  it("flytter opgaven til en egen bane, og banens kategori sætter status", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const task = await api.tasks.create({
      token: acc.token,
      data: { title: "Til fakturering" },
    });
    const lanes = await api.tasks.statuses({ token: acc.token });
    expect(lanes.map((l) => l.category)).toEqual([
      "not_started",
      "not_started",
      "in_progress",
      "done",
    ]);
    const done = lanes.find((l) => l.category === "done");
    if (!done) throw new Error("ingen afsluttet-bane");

    await api.tasks.move({
      token: acc.token,
      data: { taskId: task.id, statusId: done.id },
    });
    const row = await db.query.tasks.findFirst({
      where: eq(tasks.id, task.id),
    });
    expect(row?.statusId).toBe(done.id);
    expect(row?.status).toBe("done");
    expect(row?.completedAt).toBeInstanceOf(Date);

    const other = await seedAccount();
    const err = await errorOf(
      api.tasks.move({
        token: other.token,
        data: { taskId: task.id, statusId: done.id },
      }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("en anden org kan hverken se eller ændre opgaven", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    const api = deviceCaller().extension;
    const task = await api.tasks.create({
      token: a.token,
      data: { title: "Hemmelig opgave" },
    });
    const bList = await api.tasks.list({ token: b.token });
    expect(bList.map((t) => t.id)).not.toContain(task.id);
    const err = await errorOf(
      api.tasks.setStatus({ token: b.token, id: task.id, status: "done" }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("slukket opgave-modul i org'en blokerer token-kald som i web", async () => {
    const acc = await seedAccount();
    await db.insert(organizationModules).values(
      MODULE_KEYS.map((moduleKey) => ({
        organizationId: acc.orgId,
        moduleKey,
        isAvailable: true,
        isEnabled: moduleKey !== "tasks",
      })),
    );
    const err = await errorOf(
      deviceCaller().extension.tasks.list({ token: acc.token }),
    );
    expect(err.code).toBe("FORBIDDEN");
    const ent = await deviceCaller().extension.entitlements.get({
      token: acc.token,
    });
    expect(ent.modules.tasks).toBe(false);
    expect(ent.features.tasks).toBe(false);
  });
});
