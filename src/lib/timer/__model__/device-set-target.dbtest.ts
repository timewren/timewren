/**
 * Desktop 0.2.23: skift kunde/projekt/opgave på en kørende timer uden at
 * stoppe den (`extension.timer.setTarget`), og `taskId` på den fælles timer
 * (`updateTimerState`, `getTimerStateWithVersion`, `claimForStop.session`).
 *
 * Skiftet er en metadata-skrivning i updateTimerState: atomisk upsert med
 * sessions-prædikat, ingen read-then-write. Testene tjekker, at skiftet kun
 * lander på den session, appen ser, aldrig midt i et stop, aldrig genopliver
 * en ryddet række, og at stoppet gemmer det nye mål.
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { timerEvents, timerSessions, timerStates } from "@/lib/db/schema";
import {
  type Account,
  deviceCaller,
  seedAccount,
  webCaller,
} from "@/lib/trpc/routers/ext/__tests__/fixture";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

/** To kunder med hvert sit projekt, og en opgave på projekt B. */
async function seedTargets(acc: Account) {
  const api = deviceCaller().extension;
  const ca = await api.clients.create({
    token: acc.token,
    data: { name: "Kunde A" },
  });
  const cb = await api.clients.create({
    token: acc.token,
    data: { name: "Kunde B" },
  });
  const pa = await api.projects.create({
    token: acc.token,
    data: { name: "Projekt A", clientId: ca.id },
  });
  const pb = await api.projects.create({
    token: acc.token,
    data: { name: "Projekt B", clientId: cb.id },
  });
  const task = await api.tasks.create({
    token: acc.token,
    data: { title: "Opgave B", projectId: pb.id },
  });
  return { ca, cb, pa, pb, task };
}

async function startTimer(acc: Account, projectId: string, clientId: string) {
  const api = deviceCaller().extension;
  const started = await api.updateTimerState({
    token: acc.token,
    source: "extension",
    isRunning: true,
    isFreshStart: true,
    clientOpId: randomUUID(),
    startTime: new Date(Date.now() - 600_000).toISOString(),
    baseSeconds: 0,
    elapsedSeconds: 0,
    projectId,
    clientId,
    description: "Arbejde",
  });
  expect(started.sessionId).toBeTruthy();
  return started;
}

function readRow(userId: string) {
  return db.query.timerStates.findFirst({
    where: eq(timerStates.userId, userId),
  });
}

describe.skipIf(!enabled)("extension.timer.setTarget (desktop)", () => {
  it("skifter mål og opgave på en kørende timer uden at stoppe den", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const api = deviceCaller().extension;
    const started = await startTimer(acc, t.pa.id, t.ca.id);
    const before = await readRow(acc.userId);

    const res = await api.timer.setTarget({
      token: acc.token,
      sessionId: started.sessionId as string,
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
    });
    expect(res).toMatchObject({
      isRunning: true,
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
      sessionId: started.sessionId,
      sessionMismatch: false,
    });
    expect(res.version).toBe((before?.version ?? 0) + 1);

    // Timeren kører videre på samme session og samme starttid.
    const row = await readRow(acc.userId);
    expect(row?.isRunning).toBe(true);
    expect(row?.startTime?.getTime()).toBe(before?.startTime?.getTime());
    expect(row?.currentSessionId).toBe(started.sessionId);
    expect(row?.lastSyncedFrom).toBe("extension");
    expect(row?.taskId).toBe(t.task.id);

    // Sessionen følger med (det er den, stop og genopretning læser).
    const session = await db.query.timerSessions.findFirst({
      where: eq(timerSessions.id, started.sessionId as string),
    });
    expect(session).toMatchObject({
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
    });

    // Hændelsesloggen viser kundeskiftet.
    const events = await db.query.timerEvents.findMany({
      where: and(
        eq(timerEvents.userId, acc.userId),
        eq(timerEvents.event, "client_change"),
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0].clientId).toBe(t.cb.id);

    // getTimerStateWithVersion og claimForStop bærer opgaven.
    const state = await api.getTimerStateWithVersion({ token: acc.token });
    expect(state.taskId).toBe(t.task.id);
    const claim = await api.claimForStop({
      token: acc.token,
      expectedVersion: state.version,
      source: "extension",
      sessionId: started.sessionId as string,
    });
    expect(claim.success).toBe(true);
    if (claim.success) {
      expect(claim.session).toMatchObject({
        projectId: t.pb.id,
        clientId: t.cb.id,
        taskId: t.task.id,
      });
    }
  });

  it("uden taskId ryddes opgaven: målet er hele trippelen", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const api = deviceCaller().extension;
    const started = await startTimer(acc, t.pb.id, t.cb.id);
    const sessionId = started.sessionId as string;
    await api.timer.setTarget({
      token: acc.token,
      sessionId,
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
    });
    const res = await api.timer.setTarget({
      token: acc.token,
      sessionId,
      projectId: t.pa.id,
      clientId: t.ca.id,
    });
    expect(res.taskId).toBeNull();
    expect((await readRow(acc.userId))?.taskId).toBeNull();
  });

  it("lander ikke på en anden session end appens (sessionMismatch)", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const api = deviceCaller().extension;
    const started = await startTimer(acc, t.pa.id, t.ca.id);
    const before = await readRow(acc.userId);

    const res = await api.timer.setTarget({
      token: acc.token,
      sessionId: randomUUID(),
      projectId: t.pb.id,
      clientId: t.cb.id,
    });
    expect(res.sessionMismatch).toBe(true);
    expect(res.sessionId).toBe(started.sessionId);
    const row = await readRow(acc.userId);
    expect(row?.projectId).toBe(t.pa.id);
    expect(row?.version).toBe(before?.version);
  });

  it("lander ikke midt i et stop fra en anden klient", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const api = deviceCaller().extension;
    const started = await startTimer(acc, t.pa.id, t.ca.id);
    const state = await api.getTimerStateWithVersion({ token: acc.token });
    // Web claimer stoppet (gem-dialogen er åben).
    const claim = await webCaller(acc).timerSync.claimForStop({
      expectedVersion: state.version,
      source: "web",
    });
    expect(claim.success).toBe(true);

    const res = await api.timer.setTarget({
      token: acc.token,
      sessionId: started.sessionId as string,
      projectId: t.pb.id,
      clientId: t.cb.id,
    });
    expect(res).toMatchObject({ stoppingInProgress: true });
    const row = await readRow(acc.userId);
    expect(row?.projectId).toBe(t.pa.id);
    expect(row?.intent).toBe("stopping");
  });

  it("genopliver ikke en stoppet og ryddet timer", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const api = deviceCaller().extension;
    const started = await startTimer(acc, t.pa.id, t.ca.id);
    const sessionId = started.sessionId as string;
    const state = await api.getTimerStateWithVersion({ token: acc.token });
    const claim = await api.claimForStop({
      token: acc.token,
      expectedVersion: state.version,
      source: "extension",
      sessionId,
    });
    expect(claim.success).toBe(true);
    if (!claim.success) return;
    await api.confirmStop({
      token: acc.token,
      version: claim.version,
      source: "extension",
      sessionId,
    });

    const res = await api.timer.setTarget({
      token: acc.token,
      sessionId,
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
    });
    expect(res.sessionMismatch).toBe(true);
    const row = await readRow(acc.userId);
    expect(row).toMatchObject({
      isRunning: false,
      elapsedSeconds: 0,
      baseSeconds: 0,
      projectId: null,
      clientId: null,
      taskId: null,
      currentSessionId: null,
    });
  });

  it("kapløb mod et stop: enten landet før stoppet eller afvist, aldrig genoplivet", async () => {
    for (let round = 0; round < 5; round++) {
      const acc = await seedAccount();
      const t = await seedTargets(acc);
      const api = deviceCaller().extension;
      const started = await startTimer(acc, t.pa.id, t.ca.id);
      const sessionId = started.sessionId as string;
      const state = await api.getTimerStateWithVersion({ token: acc.token });

      const stop = (async () => {
        const claim = await webCaller(acc).timerSync.claimForStop({
          expectedVersion: state.version,
          source: "web",
        });
        if (!claim.success) return claim;
        await webCaller(acc).timerSync.confirmStop({
          version: claim.version,
          source: "web",
        });
        return claim;
      })();
      const change = api.timer.setTarget({
        token: acc.token,
        sessionId,
        projectId: t.pb.id,
        clientId: t.cb.id,
        taskId: t.task.id,
      });
      const [claim, res] = await Promise.all([stop, change]);

      const row = await readRow(acc.userId);
      if (claim.success) {
        // Stoppet vandt (evt. efter skiftet): rækken er ryddet.
        expect(row).toMatchObject({
          isRunning: false,
          elapsedSeconds: 0,
          projectId: null,
          taskId: null,
          currentSessionId: null,
        });
        if (claim.session.projectId === t.pb.id) {
          // Skiftet landede før claimet: stoppet gemmer det nye mål.
          expect(claim.session.taskId).toBe(t.task.id);
          expect(res.sessionMismatch).toBe(false);
        }
      } else {
        // Skiftet bumpede versionen før claimet: timeren kører på det nye mål.
        expect(row).toMatchObject({
          isRunning: true,
          projectId: t.pb.id,
          taskId: t.task.id,
        });
      }
    }
  });

  it("afviser en opgave fra en anden organisation", async () => {
    const acc = await seedAccount();
    const other = await seedAccount();
    const t = await seedTargets(acc);
    const foreign = await seedTargets(other);
    const api = deviceCaller().extension;
    const started = await startTimer(acc, t.pa.id, t.ca.id);

    const err = await errorOf(
      api.timer.setTarget({
        token: acc.token,
        sessionId: started.sessionId as string,
        projectId: t.pa.id,
        clientId: t.ca.id,
        taskId: foreign.task.id,
      }),
    );
    expect(err.code).toBe("NOT_FOUND");
    expect((await readRow(acc.userId))?.taskId).toBeNull();
  });

  it("uden timer-række: sessionMismatch, og ingen række oprettes", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const res = await deviceCaller().extension.timer.setTarget({
      token: acc.token,
      sessionId: randomUUID(),
      projectId: t.pa.id,
      clientId: t.ca.id,
      taskId: t.task.id,
    });
    expect(res).toMatchObject({ sessionMismatch: true, isRunning: false });
    expect(await readRow(acc.userId)).toBeUndefined();
  });

  it("rydning og quickStart efterlader ingen gammel opgave", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const api = deviceCaller().extension;
    const started = await startTimer(acc, t.pb.id, t.cb.id);
    await api.timer.setTarget({
      token: acc.token,
      sessionId: started.sessionId as string,
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
    });
    // Udvidelsens nulstil (ingen tid, intet taskId).
    await api.updateTimerState({
      token: acc.token,
      source: "extension",
      isRunning: false,
      elapsedSeconds: 0,
      baseSeconds: 0,
      sessionId: started.sessionId as string,
    });
    expect(
      (await api.getTimerStateWithVersion({ token: acc.token })).taskId,
    ).toBeNull();

    // Opgaven igen, så quickStart (udvidelsens hurtigstart).
    const again = await startTimer(acc, t.pb.id, t.cb.id);
    await api.timer.setTarget({
      token: acc.token,
      sessionId: again.sessionId as string,
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
    });
    const state = await api.getTimerStateWithVersion({ token: acc.token });
    const claim = await api.claimForStop({
      token: acc.token,
      expectedVersion: state.version,
      source: "extension",
      sessionId: again.sessionId as string,
    });
    expect(claim.success).toBe(true);
    if (!claim.success) return;
    await api.confirmStop({
      token: acc.token,
      version: claim.version,
      source: "extension",
      sessionId: again.sessionId as string,
    });
    await db
      .update(timerStates)
      .set({ taskId: t.task.id })
      .where(eq(timerStates.userId, acc.userId));
    await api.quickStart({ token: acc.token, description: "Hurtig" });
    expect(
      (await api.getTimerStateWithVersion({ token: acc.token })).taskId,
    ).toBeNull();
  });

  it("updateTimerState tager taskId, og en frisk start uden opgave rydder den", async () => {
    const acc = await seedAccount();
    const t = await seedTargets(acc);
    const api = deviceCaller().extension;
    const started = await api.updateTimerState({
      token: acc.token,
      source: "extension",
      isRunning: true,
      isFreshStart: true,
      clientOpId: randomUUID(),
      startTime: new Date().toISOString(),
      projectId: t.pb.id,
      clientId: t.cb.id,
      taskId: t.task.id,
    });
    expect(started.taskId).toBe(t.task.id);

    // Ryd (som udvidelsens nulstil), og start forfra uden opgave: den gamle
    // opgave må ikke følge med over i den nye session.
    await api.updateTimerState({
      token: acc.token,
      source: "extension",
      isRunning: false,
      elapsedSeconds: 0,
      baseSeconds: 0,
      sessionId: started.sessionId as string,
    });
    const fresh = await api.updateTimerState({
      token: acc.token,
      source: "extension",
      isRunning: true,
      isFreshStart: true,
      clientOpId: randomUUID(),
      startTime: new Date().toISOString(),
      projectId: t.pa.id,
      clientId: t.ca.id,
    });
    expect(fresh.taskId).toBeNull();
  });
});
