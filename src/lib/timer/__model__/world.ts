/**
 * Testverden for de modelbaserede timer-tests: én bruger pr. kørsel, rigtige
 * tRPC-routere (timerSync, extension, time) mod en rigtig Postgres og et
 * simuleret serverur.
 *
 * Kun til `*.dbtest.ts` — kræver DATABASE_URL til en kasseret database.
 */

import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { vi } from "vitest";
import { db } from "@/lib/db";
import {
  clients,
  extensionTokens,
  members,
  organizations,
  prepaidPackages,
  prepaidUsage,
  projects,
  subscriptions,
  timeEntries,
  timerSessions,
  timerStates,
  users,
} from "@/lib/db/schema";
import { hashToken } from "@/lib/security/token-hash";
import { extensionRouter } from "@/lib/trpc/routers/extension";
import { timeRouter } from "@/lib/trpc/routers/time";
import { timerSyncRouter } from "@/lib/trpc/routers/timerSync";
import { router } from "@/lib/trpc/trpc";

const modelRouter = router({
  timerSync: timerSyncRouter,
  extension: extensionRouter,
  time: timeRouter,
});

export type ModelCaller = ReturnType<typeof modelRouter.createCaller>;

/** To mål brugeren kan vælge: A har klippekort (auto-træk), B har ikke. */
export type TargetKey = "A" | "B";

export interface Target {
  projectId: string;
  clientId: string;
  prepaidPackageId: string | null;
}

export interface Fixture {
  userId: string;
  orgId: string;
  token: string;
  targets: Record<TargetKey, Target>;
  packageId: string;
}

/** Serverens ur. Kun `Date` er falsk — setTimeout m.m. er ægte (DB-driveren). */
export class SimClock {
  readonly start: number;
  now: number;
  constructor(start: number) {
    this.start = start;
    this.now = start;
    vi.setSystemTime(start);
  }
  advance(ms: number): void {
    this.now += Math.max(0, Math.round(ms));
    vi.setSystemTime(this.now);
  }
}

export async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const userId = `model-${suffix}`;
  const orgId = `model-org-${suffix}`;
  const token = `model-token-${suffix}`;
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    email: `${userId}@model.test`,
    name: "Model",
    emailVerified: true,
  } as never);
  // Et aktivt medlemskab — orgless-gaten afviser al organisationsdata uden
  // det (#848), og klient/projekt/klippekort nedenfor hører til orgen.
  await db.insert(organizations).values({
    id: orgId,
    name: "Model Org",
    slug: orgId,
  } as never);
  await db.insert(members).values({
    id: `model-member-${suffix}`,
    organizationId: orgId,
    userId,
    role: "owner",
  } as never);
  await db.insert(subscriptions).values({
    userId,
    billingCycle: "monthly",
    status: "active",
    isTrial: false,
    trialEndsAt: new Date(now.getTime() + 365 * 86_400_000),
  } as never);
  const [c1, c2] = await db
    .insert(clients)
    .values([
      { name: "Kunde A", userId, organizationId: orgId },
      { name: "Kunde B", userId, organizationId: orgId },
    ] as never)
    .returning({ id: clients.id });
  const [p1, p2] = await db
    .insert(projects)
    .values([
      { name: "Projekt A", userId, organizationId: orgId, clientId: c1.id },
      { name: "Projekt B", userId, organizationId: orgId, clientId: c2.id },
    ] as never)
    .returning({ id: projects.id });
  const [pkg] = await db
    .insert(prepaidPackages)
    .values({
      name: "Klippekort A",
      clientId: c1.id,
      userId,
      organizationId: orgId,
      totalHours: "1000",
      usedHours: "0",
      remainingHours: "1000",
      hourlyRate: "1000",
      totalValue: "1000000",
      purchaseDate: new Date(now.getTime() - 86_400_000),
    } as never)
    .returning({ id: prepaidPackages.id });
  await db.insert(extensionTokens).values({
    userId,
    tokenHash: hashToken(token),
    name: "Model-extension",
    isRevoked: false,
  } as never);

  return {
    userId,
    orgId,
    token,
    packageId: pkg.id,
    targets: {
      A: { projectId: p1.id, clientId: c1.id, prepaidPackageId: pkg.id },
      B: { projectId: p2.id, clientId: c2.id, prepaidPackageId: null },
    },
  };
}

/** Caller som en indlogget web-/app-bruger. */
export function sessionCaller(fx: Fixture, headers?: HeadersInit): ModelCaller {
  return modelRouter.createCaller({
    session: {
      user: { id: fx.userId, email: `${fx.userId}@model.test`, name: "Model" },
      session: { id: `sess-${fx.userId}`, userId: fx.userId },
      activeOrganizationId: fx.orgId,
    },
    db,
    headers: new Headers(headers),
  } as never);
}

/**
 * Caller som extensionen: ingen session, token i input. `version` er
 * versionsheaderen (2.6.0 = sessionsbevidst, 2.5.2 = ældre klient).
 */
export function tokenCaller(version = "2.5.2"): ModelCaller {
  return modelRouter.createCaller({
    session: null,
    db,
    headers: new Headers({
      "user-agent": "Mozilla/5.0 model-extension",
      "x-timetrack-client": `extension/${version}`,
    }),
  } as never);
}

export async function readTimerRow(userId: string) {
  return db.query.timerStates.findFirst({
    where: eq(timerStates.userId, userId),
  });
}

/** Brugerens server-udstedte timer-sessioner (timer-sessioner, fase 1). */
export async function readSessions(userId: string) {
  return db.query.timerSessions.findMany({
    where: eq(timerSessions.userId, userId),
  });
}

export async function readEntries(userId: string) {
  return db.query.timeEntries.findMany({
    where: eq(timeEntries.userId, userId),
  });
}

export async function readPrepaid(packageId: string) {
  const pkg = await db.query.prepaidPackages.findFirst({
    where: eq(prepaidPackages.id, packageId),
  });
  const usage = await db.query.prepaidUsage.findMany({
    where: eq(prepaidUsage.prepaidPackageId, packageId),
  });
  return { pkg, usage };
}

/**
 * Fremtving resten fra review P3: rækken står pauset (uden for et stop) på
 * brugerens senest gemte session — som når et quickStops nulstilling tabte et
 * kapløb før rettelsen. Kun til scenarietests af oprydningen.
 */
export async function forceSavedSessionLeftover(
  userId: string,
  seconds: number,
): Promise<string> {
  const [saved] = await db
    .select({ id: timerSessions.id })
    .from(timerSessions)
    .where(
      sql`${timerSessions.userId} = ${userId} AND ${timerSessions.status} = 'saved'`,
    )
    .orderBy(desc(timerSessions.updatedAt))
    .limit(1);
  if (!saved) throw new Error("Ingen gemt session at efterlade");
  await db
    .update(timerStates)
    .set({
      isRunning: false,
      startTime: null,
      baseSeconds: seconds,
      elapsedSeconds: seconds,
      intent: null,
      intentAt: null,
      intentFrom: null,
      currentSessionId: saved.id,
      version: sql`${timerStates.version} + 1`,
    })
    .where(eq(timerStates.userId, userId));
  return saved.id;
}
