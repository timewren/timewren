import { appUrlEnv } from "@/lib/runtime-env";
/**
 * Stabilitetsvagten — orkestrering: kør detektorerne over vinduet, afstem
 * med stability_findings og send alarmer (Discord + Sentry) ved
 * tilstandsskift. Kaldes af /api/cron/stability-watch hvert 15. minut.
 */

import * as Sentry from "@sentry/nextjs";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { minClientVersionsFromEnv } from "@/lib/client-version";
import { getAppUrl } from "@/lib/config";
import { EXPECTED_INTERVAL_MINUTES } from "@/lib/cron/expected-schedule";
import type { db as DbClient } from "@/lib/db";
import {
  organizations,
  stabilityFindings,
  timerEvents,
  users,
} from "@/lib/db/schema";
import { sendAdminDiscordEmbed } from "@/lib/notifications/admin";
import { getRealtimeStatus, probeRealtime } from "@/lib/realtime";
import { isSyntheticUserId } from "@/lib/synthetic-users";
import { captureServerMessage } from "@/lib/utils/sentry";
import { SERVER_VERSION } from "@/lib/version/server-version";
import {
  DETECTORS,
  type DetectedFinding,
  type DetectorId,
  detectClientSwitches,
  detectDateMismatch,
  detectDuplicateSessions,
  detectHoursMismatch,
  detectOutdatedClients,
  detectPrepaidInconsistency,
  detectRealtimeDown,
  detectRunawayTimers,
  detectStaleClients,
  detectStaleCrons,
  detectTimeJumps,
  detectZombieClears,
  type Severity,
} from "./detectors";
import {
  queryClientChanges,
  queryClientVersions,
  queryCronLastRuns,
  queryDateMismatch,
  queryDuplicatePairs,
  queryHoursMismatch,
  queryLastWatchRun,
  queryPrepaidPackages,
  queryRunningTimers,
  querySessionOverlapPairs,
  querySignalCounts,
  queryStaleClientContext,
  queryTimeChanges,
  queryZombieClears,
} from "./queries";
import {
  ALERT_TITLES,
  type AlertKind,
  computeWindowStart,
  DISCORD_DESCRIPTION_LIMIT,
  DISCORD_TITLE_LIMIT,
  formatAlertDescription,
  isHourlySlot,
  reconcileFindings,
  type StoredFinding,
  type TrailEvent,
  truncateForDiscord,
} from "./reconcile";

type Db = typeof DbClient;

const MAX_ALERTS_PER_RUN = 10;

export const RUNBOOK_URL =
  "https://github.com/mahope/timetrack/blob/main/docs/runbooks/timer-fejlsoegning.md";

export interface WatchSummary {
  windowStart: string;
  ran: DetectorId[];
  failed: { detector: string; error: string }[];
  detected: number;
  inserted: number;
  updated: number;
  resolved: number;
  alerts: number;
  byDetector: Record<string, number>;
}

async function resolveWebhookUrl(db: Db): Promise<string | undefined> {
  // Samme rækkefølge som migration-drift: admin-indstilling, ellers env.
  let url = process.env.ADMIN_DISCORD_WEBHOOK_URL;
  try {
    const settings = await db.query.adminSettings.findMany();
    url = settings.find((s) => s.id === "discord_webhook_url")?.value || url;
  } catch (err) {
    console.error("[Stability] Kunne ikke læse admin-settings:", err);
  }
  return url || undefined;
}

async function loadTrail(
  db: Db,
  userId: string,
  from: Date,
): Promise<TrailEvent[]> {
  const rows = await db
    .select({
      createdAt: timerEvents.createdAt,
      event: timerEvents.event,
      source: timerEvents.source,
      clientHint: timerEvents.clientHint,
      startTime: timerEvents.startTime,
      versionAfter: timerEvents.versionAfter,
      clientId: timerEvents.clientId,
    })
    .from(timerEvents)
    .where(
      and(eq(timerEvents.userId, userId), gte(timerEvents.createdAt, from)),
    )
    .orderBy(desc(timerEvents.createdAt))
    .limit(12);
  return rows.reverse().map((r) => ({
    createdAt: r.createdAt,
    event: r.event,
    source: r.source,
    clientHint: r.clientHint,
    startTime: r.startTime,
    versionAfter: r.versionAfter,
    // Sporet går til Discord: kun kunde-id, aldrig kundens kunders navne
    clientName: null,
    clientId: r.clientId,
  }));
}

async function loadNames(
  db: Db,
  userIds: string[],
  orgIds: string[],
): Promise<{
  users: Map<string, string>;
  orgs: Map<string, string>;
}> {
  const [u, o] = await Promise.all([
    userIds.length
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    orgIds.length
      ? db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, orgIds))
      : Promise.resolve([]),
  ]);
  return {
    users: new Map(u.map((r) => [r.id, `${r.name || r.email} <${r.email}>`])),
    orgs: new Map(o.map((r) => [r.id, r.name])),
  };
}

const COLORS: Record<AlertKind | Severity, number> = {
  critical: 0xef4444,
  warning: 0xf59e0b,
  info: 0x3b82f6,
  new: 0xef4444,
  recurred: 0xef4444,
  reminder: 0xf59e0b,
  resolved: 0x22c55e,
};

interface PendingAlert {
  id: string;
  kind: AlertKind;
  detector: DetectorId;
  severity: Severity;
  fingerprint: string;
  title: string;
  userId: string | null;
  organizationId: string | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  /** Fundets lastAlertedAt før denne alarm — identificerer "episoden" */
  prevLastAlertedAt: Date | null;
  /** Episoden Sentry allerede har fået besked om (sample.sentryKey) */
  sentryKey: string | null;
}

function storedSentryKey(sample: unknown): string | null {
  const key = (sample as Record<string, unknown> | null)?.sentryKey;
  return typeof key === "string" ? key : null;
}

export async function runStabilityWatch(
  db: Db,
  options: { now?: Date; forcePrepaid?: boolean } = {},
): Promise<WatchSummary> {
  const now = options.now ?? new Date();
  const windowStart = computeWindowStart(await queryLastWatchRun(db), now);

  const detected: DetectedFinding[] = [];
  const ran = new Set<DetectorId>();
  const failed: { detector: string; error: string }[] = [];

  // Én detektor ad gangen: billigt på DB'en, og en fejl i én fælder ikke
  // de andre (og en fejlet detektor løser aldrig sine åbne fund).
  async function step(
    ids: DetectorId[],
    fn: () => Promise<DetectedFinding[]>,
  ): Promise<void> {
    try {
      // Syntetiske overvågningskonti alarmerer via deres eget check
      detected.push(
        ...(await fn()).filter((f) => !isSyntheticUserId(f.userId)),
      );
      for (const id of ids) ran.add(id);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[Stability] ${ids.join("+")} fejlede:`, error);
      failed.push({ detector: ids.join("+"), error });
    }
  }

  await step(["duplicate_session"], async () =>
    detectDuplicateSessions(
      await queryDuplicatePairs(db, windowStart),
      await querySessionOverlapPairs(db, windowStart),
    ),
  );
  await step(["stale_client"], async () =>
    detectStaleClients(await querySignalCounts(db), {
      currentWebBuild: SERVER_VERSION,
      ...(await queryStaleClientContext(db)),
    }),
  );
  await step(["runaway_timer"], async () =>
    detectRunawayTimers(await queryRunningTimers(db), now),
  );
  await step(["zombie_timer"], async () =>
    detectZombieClears(await queryZombieClears(db, windowStart)),
  );
  await step(["time_jump"], async () =>
    detectTimeJumps(await queryTimeChanges(db, windowStart)),
  );
  await step(["client_switch"], async () =>
    detectClientSwitches(await queryClientChanges(db, windowStart)),
  );
  await step(["hours_mismatch"], async () =>
    detectHoursMismatch(await queryHoursMismatch(db, windowStart)),
  );
  await step(["date_mismatch"], async () =>
    detectDateMismatch(await queryDateMismatch(db, windowStart)),
  );
  if (options.forcePrepaid || isHourlySlot(now)) {
    await step(["prepaid_inconsistency"], async () =>
      detectPrepaidInconsistency(await queryPrepaidPackages(db)),
    );
  }
  await step(["realtime_down"], async () => {
    // probeRealtime() starter selv abonnent og kommando-klient i en kold
    // proces og venter (højst 3 s) på at begge er klar, før den dømmer.
    const probe = await probeRealtime();
    const status = getRealtimeStatus();
    return detectRealtimeDown({
      enabled: status.enabled,
      configured: status.configured,
      subscribed: status.subscribed,
      probeOk: probe ? probe.ok : null,
      probeMs: probe ? probe.ms : null,
      lastError: status.lastError,
    });
  });
  await step(["cron_stale"], async () =>
    detectStaleCrons(
      await queryCronLastRuns(db),
      EXPECTED_INTERVAL_MINUTES,
      now,
    ),
  );

  await step(["outdated_client"], async () =>
    detectOutdatedClients(
      await queryClientVersions(db),
      minClientVersionsFromEnv(),
    ),
  );

  // ─── Afstem med de gemte fund ───────────────────────────────────────
  const storedRows = await db
    .select()
    .from(stabilityFindings)
    .where(isNull(stabilityFindings.resolvedAt));
  const stored: StoredFinding[] = storedRows.map((r) => ({
    id: r.id,
    detector: r.detector as DetectorId,
    severity: r.severity as Severity,
    fingerprint: r.fingerprint,
    status: r.status === "ignored" ? "ignored" : "open",
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    count: r.count,
    lastAlertedAt: r.lastAlertedAt,
    sample: (r.sample as Record<string, unknown> | null) ?? null,
  }));

  const storedFps = new Set(stored.map((s) => s.fingerprint));
  const newFps = [
    ...new Set(
      detected.map((d) => d.fingerprint).filter((f) => !storedFps.has(f)),
    ),
  ];
  const previouslyResolved = new Set(
    newFps.length
      ? (
          await db
            .selectDistinct({ fingerprint: stabilityFindings.fingerprint })
            .from(stabilityFindings)
            .where(
              and(
                inArray(stabilityFindings.fingerprint, newFps),
                isNotNull(stabilityFindings.resolvedAt),
              ),
            )
        ).map((r) => r.fingerprint)
      : [],
  );

  const plan = reconcileFindings({
    stored,
    detected,
    ranDetectors: ran,
    previouslyResolved,
    now,
  });

  const alerts: PendingAlert[] = [];
  const storedById = new Map(stored.map((s) => [s.id, s]));

  for (const ins of plan.inserts) {
    const f = ins.finding;
    const [row] = await db
      .insert(stabilityFindings)
      .values({
        detector: f.detector,
        severity: f.severity,
        fingerprint: f.fingerprint,
        status: "open",
        userId: f.userId,
        organizationId: f.organizationId,
        title: f.title,
        firstSeen: now,
        lastSeen: now,
        count: ins.count,
        sample: f.sample,
      })
      // En samtidig kørsel kan have oprettet det — så er det dens alarm
      .onConflictDoNothing()
      .returning({ id: stabilityFindings.id });
    if (row && ins.alert) {
      alerts.push({
        id: row.id,
        kind: ins.alert,
        detector: f.detector,
        severity: f.severity,
        fingerprint: f.fingerprint,
        title: f.title,
        userId: f.userId,
        organizationId: f.organizationId,
        count: ins.count,
        firstSeen: now,
        lastSeen: now,
        prevLastAlertedAt: null,
        sentryKey: null,
      });
    }
  }

  for (const up of plan.updates) {
    const prev = storedById.get(up.id);
    await db
      .update(stabilityFindings)
      .set({
        severity: up.severity,
        count: up.count,
        // Bevar Sentry-episoden: reconcile bygger sample forfra hver kørsel
        sample: storedSentryKey(prev?.sample)
          ? { ...up.sample, sentryKey: storedSentryKey(prev?.sample) }
          : up.sample,
        ...(up.touchLastSeen ? { lastSeen: now, title: up.finding.title } : {}),
        updatedAt: now,
      })
      .where(eq(stabilityFindings.id, up.id));
    if (up.alert && prev) {
      alerts.push({
        id: up.id,
        kind: up.alert,
        detector: up.finding.detector,
        severity: up.severity,
        fingerprint: up.finding.fingerprint,
        title: up.finding.title,
        userId: up.finding.userId,
        organizationId: up.finding.organizationId,
        count: up.count,
        firstSeen: prev.firstSeen,
        lastSeen: up.touchLastSeen ? now : prev.lastSeen,
        prevLastAlertedAt: prev.lastAlertedAt,
        sentryKey: storedSentryKey(prev.sample),
      });
    }
  }

  for (const res of plan.resolves) {
    await db
      .update(stabilityFindings)
      .set({
        status: "resolved",
        resolvedAt: now,
        resolvedBy: "auto",
        updatedAt: now,
      })
      .where(
        and(
          eq(stabilityFindings.id, res.id),
          isNull(stabilityFindings.resolvedAt),
        ),
      );
    if (res.alert) {
      const row = storedRows.find((r) => r.id === res.id);
      alerts.push({
        id: res.id,
        kind: res.alert,
        detector: res.stored.detector,
        severity: res.stored.severity,
        fingerprint: res.stored.fingerprint,
        title: row?.title ?? res.stored.fingerprint,
        userId: row?.userId ?? null,
        organizationId: row?.organizationId ?? null,
        count: res.stored.count,
        firstSeen: res.stored.firstSeen,
        lastSeen: res.stored.lastSeen,
        prevLastAlertedAt: res.stored.lastAlertedAt,
        sentryKey: storedSentryKey(res.stored.sample),
      });
    }
  }

  const sent = await dispatchAlerts(db, alerts, now);

  const byDetector: Record<string, number> = {};
  for (const d of detected)
    byDetector[d.detector] = (byDetector[d.detector] ?? 0) + 1;

  return {
    windowStart: windowStart.toISOString(),
    ran: [...ran],
    failed,
    detected: detected.length,
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    resolved: plan.resolves.length,
    alerts: sent,
    byDetector,
  };
}

async function dispatchAlerts(
  db: Db,
  alerts: PendingAlert[],
  now: Date,
): Promise<number> {
  if (alerts.length === 0) return 0;
  const webhookUrl = await resolveWebhookUrl(db);
  const names = await loadNames(
    db,
    [...new Set(alerts.map((a) => a.userId).filter(Boolean))] as string[],
    [
      ...new Set(alerts.map((a) => a.organizationId).filter(Boolean)),
    ] as string[],
  );
  const appUrl = getAppUrl();
  const environment = appUrlEnv() || "ukendt";

  // Kritiske først, så et loft rammer de mindst vigtige
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  const ordered = [...alerts].sort(
    (a, b) => rank[a.severity] - rank[b.severity],
  );
  const batch = ordered.slice(0, MAX_ALERTS_PER_RUN);
  const overflow = ordered.slice(MAX_ALERTS_PER_RUN);

  let sent = 0;
  let discordFailureReported = false;
  const reportDiscordFailure = (err: unknown) => {
    console.error("[Stability] Discord-alarm fejlede:", err);
    // Én gang pr. kørsel (fx 400 ved for lang besked, 429, nedbrud)
    if (discordFailureReported) return;
    discordFailureReported = true;
    Sentry.captureException(err, {
      tags: {
        source: "cron",
        route: "stability-watch",
        stability_discord: "failed",
      },
    });
  };

  for (const a of batch) {
    const who = a.userId
      ? [
          names.users.get(a.userId) ?? a.userId,
          a.organizationId
            ? `(${names.orgs.get(a.organizationId) ?? a.organizationId})`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;
    const trail =
      a.userId && a.kind !== "resolved"
        ? await loadTrail(
            db,
            a.userId,
            new Date(a.firstSeen.getTime() - 30 * 60_000),
          ).catch(() => [])
        : [];
    const description = formatAlertDescription({
      kind: a.kind,
      detector: a.detector,
      severity: a.severity,
      title: a.title,
      who,
      count: a.count,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      trail,
      adminUrl: `${appUrl}/admin/stabilitet?fund=${a.id}`,
      userUrl: a.userId
        ? `${appUrl}/admin/users/${a.userId}?tab=timerlog`
        : null,
      runbookUrl: `${RUNBOOK_URL}#${DETECTORS[a.detector].runbookAnchor}`,
      environment,
    });

    // Kun når Discord faktisk tog imod (eller ingen webhook er sat) regnes
    // alarmen for sendt — ellers prøves den igen i næste kørsel.
    let delivered = true;
    if (webhookUrl) {
      try {
        await sendAdminDiscordEmbed({
          webhookUrl,
          title: truncateForDiscord(
            `${a.kind === "resolved" ? "✅" : a.severity === "critical" ? "🚨" : "⚠️"} ${ALERT_TITLES[a.kind]}: ${DETECTORS[a.detector].label}`,
            DISCORD_TITLE_LIMIT,
          ),
          description: truncateForDiscord(
            description,
            DISCORD_DESCRIPTION_LIMIT,
          ),
          color: COLORS[a.kind === "resolved" ? "resolved" : a.severity],
          url: `${appUrl}/admin/stabilitet?fund=${a.id}`,
          timestamp: now.toISOString(),
        });
      } catch (err) {
        delivered = false;
        reportDiscordFailure(err);
      }
    }

    // Sentry: et "issue" pr. fingerprint, så der kan laves alert-regler på
    // tagget detector (se runbook). Løst sendes ikke — Sentry løser selv.
    // Én gang pr. episode (alarmtype + forrige lastAlertedAt), uanset om
    // Discord tog imod: ellers gentages Sentry hver kørsel, mens Discord er nede.
    const episode = `${a.kind}:${a.prevLastAlertedAt?.toISOString() ?? "-"}`;
    if (
      a.kind !== "resolved" &&
      a.sentryKey !== episode &&
      DETECTORS[a.detector].sentry !== false
    ) {
      captureServerMessage(
        `[stabilitet] ${a.detector}: ${DETECTORS[a.detector].label}`,
        {
          level: a.severity === "critical" ? "error" : "warning",
          tags: {
            detector: a.detector,
            severity: a.severity,
            org: a.organizationId ?? "ingen",
            stability_alert: a.kind,
          },
          fingerprint: ["stability", a.fingerprint],
          user: a.userId ? { id: a.userId } : undefined,
          extra: { title: a.title, count: a.count, findingId: a.id },
        },
      );
      await db
        .update(stabilityFindings)
        .set({
          sample: sql`jsonb_set(coalesce(${stabilityFindings.sample}, '{}'::jsonb), '{sentryKey}', to_jsonb(${episode}::text))`,
        })
        .where(eq(stabilityFindings.id, a.id));
    }

    if (!delivered) continue;
    if (a.kind !== "resolved") {
      await db
        .update(stabilityFindings)
        .set({ lastAlertedAt: now })
        .where(eq(stabilityFindings.id, a.id));
    }
    sent++;
  }

  if (overflow.length > 0 && webhookUrl) {
    try {
      await sendAdminDiscordEmbed({
        webhookUrl,
        title: `⚠️ ${overflow.length} stabilitetsfund mere`,
        description: `${truncateForDiscord(
          overflow
            .slice(0, 20)
            .map(
              (a) =>
                `- ${DETECTORS[a.detector].label}: ${truncateForDiscord(a.title, 150)}`,
            )
            .join("\n"),
          DISCORD_DESCRIPTION_LIMIT - 100,
        )}\n\n[Se alle](${appUrl}/admin/stabilitet)`,
        color: COLORS.warning,
        url: `${appUrl}/admin/stabilitet`,
        timestamp: now.toISOString(),
      });
    } catch (err) {
      reportDiscordFailure(err);
    }
    // lastAlertedAt sættes ikke: de får deres egen besked næste kørsel
  }
  return sent;
}
