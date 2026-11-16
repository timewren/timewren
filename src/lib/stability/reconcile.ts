/**
 * Stabilitetsvagten — afstemning af nye fund mod de gemte, og hvilke
 * alarmer det udløser. Ren funktion: ingen I/O.
 *
 * Alarmregler (samme mønster som /opt/beta-sync: tilstand + dedup):
 * - Nyt fingerprint (eller OK → fejl igen efter løsning) → alarm.
 * - Uløst og stadig set → højst én påmindelse pr. 24 t.
 * - Ikke set i detektorens resolveAfterMinutes → auto-løst + "løst"-besked
 *   (kun hvis der blev alarmeret om det).
 * - Kun warning/critical alarmerer; info vises kun på admin-siden.
 * - "ignored" opdateres stille og løses aldrig automatisk.
 */

import {
  DETECTORS,
  type DetectedFinding,
  type DetectorId,
  isAlertable,
  maxSeverity,
  type Severity,
} from "./detectors";

export const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;

const MIN_WINDOW_MS = 20 * 60_000;
const MAX_WINDOW_MS = 24 * 60 * 60_000;
const OVERLAP_MS = 2 * 60_000;

/**
 * Vindue for hændelses-detektorerne: siden forrige fuldførte kørsel (med
 * lidt overlap — forekomster dedupliceres), mindst 20 min, højst 24 t.
 */
export function computeWindowStart(lastRun: Date | null, now: Date): Date {
  const nowMs = now.getTime();
  const fromLast = lastRun ? lastRun.getTime() - OVERLAP_MS : 0;
  const start = Math.max(fromLast, nowMs - MAX_WINDOW_MS);
  return new Date(Math.min(start, nowMs - MIN_WINDOW_MS));
}

/** Klippekort-tjekket kører én gang i timen (første kvarter). */
export function isHourlySlot(now: Date): boolean {
  return now.getUTCMinutes() < 15;
}
const MAX_OCCURRENCE_KEYS = 200;

export interface StoredFinding {
  id: string;
  detector: DetectorId;
  severity: Severity;
  fingerprint: string;
  status: "open" | "ignored";
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  lastAlertedAt: Date | null;
  sample: Record<string, unknown> | null;
}

export type AlertKind = "new" | "recurred" | "reminder" | "resolved";

export interface PlannedInsert {
  finding: DetectedFinding;
  count: number;
  alert: AlertKind | null;
}

export interface PlannedUpdate {
  id: string;
  finding: DetectedFinding;
  severity: Severity;
  count: number;
  /** false = samme forekomst set igen (vindues-overlap): rør ikke lastSeen */
  touchLastSeen: boolean;
  sample: Record<string, unknown>;
  alert: AlertKind | null;
}

export interface PlannedResolve {
  id: string;
  stored: StoredFinding;
  alert: AlertKind | null;
}

export interface ReconcilePlan {
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  resolves: PlannedResolve[];
}

function storedKeys(sample: Record<string, unknown> | null): string[] {
  const keys = sample?.occurrenceKeys;
  return Array.isArray(keys)
    ? keys.filter((k): k is string => typeof k === "string")
    : [];
}

function withKeys(
  finding: DetectedFinding,
  keys: string[],
): Record<string, unknown> {
  return {
    ...finding.sample,
    occurrenceKeys: keys.slice(-MAX_OCCURRENCE_KEYS),
  };
}

export function reconcileFindings(params: {
  stored: StoredFinding[];
  detected: DetectedFinding[];
  /** Detektorer der faktisk kørte (fejlede/gatede løses aldrig) */
  ranDetectors: ReadonlySet<DetectorId>;
  /** Fingerprints der tidligere har været løst (→ "recurred") */
  previouslyResolved: ReadonlySet<string>;
  now: Date;
}): ReconcilePlan {
  const { stored, detected, ranDetectors, previouslyResolved, now } = params;
  const byFingerprint = new Map(stored.map((s) => [s.fingerprint, s]));
  const plan: ReconcilePlan = { inserts: [], updates: [], resolves: [] };
  const seenFingerprints = new Set<string>();

  // Samme fingerprint to gange i én kørsel kan ikke ske med detektorerne,
  // men flet for en sikkerheds skyld.
  const merged = new Map<string, DetectedFinding>();
  for (const f of detected) {
    const prev = merged.get(f.fingerprint);
    merged.set(
      f.fingerprint,
      prev
        ? {
            ...f,
            severity: maxSeverity(prev.severity, f.severity),
            occurrenceKeys: [
              ...new Set([...prev.occurrenceKeys, ...f.occurrenceKeys]),
            ],
          }
        : f,
    );
  }

  for (const f of merged.values()) {
    seenFingerprints.add(f.fingerprint);
    const kind = DETECTORS[f.detector].kind;
    const existing = byFingerprint.get(f.fingerprint);

    if (!existing) {
      plan.inserts.push({
        finding: { ...f, sample: withKeys(f, f.occurrenceKeys) },
        count: kind === "event" ? Math.max(1, f.occurrenceKeys.length) : 1,
        alert: isAlertable(f.severity)
          ? previouslyResolved.has(f.fingerprint)
            ? "recurred"
            : "new"
          : null,
      });
      continue;
    }

    const oldKeys = storedKeys(existing.sample);
    const oldKeySet = new Set(oldKeys);
    const newKeys = f.occurrenceKeys.filter((k) => !oldKeySet.has(k));
    const isNewOccurrence = kind === "state" || newKeys.length > 0;
    const severity = maxSeverity(existing.severity, f.severity);
    const escalated = severity !== existing.severity && isAlertable(severity);

    let alert: AlertKind | null = null;
    if (existing.status === "open" && isAlertable(severity)) {
      if (!existing.lastAlertedAt || escalated) {
        alert = existing.lastAlertedAt ? "reminder" : "new";
      } else if (
        isNewOccurrence &&
        now.getTime() - existing.lastAlertedAt.getTime() >= REMINDER_AFTER_MS
      ) {
        alert = "reminder";
      }
    }

    plan.updates.push({
      id: existing.id,
      finding: f,
      severity,
      count: existing.count + (kind === "event" ? newKeys.length : 1),
      touchLastSeen: isNewOccurrence,
      sample: isNewOccurrence
        ? withKeys(f, [...oldKeys, ...newKeys])
        : (existing.sample ?? withKeys(f, oldKeys)),
      alert,
    });
  }

  for (const s of stored) {
    if (seenFingerprints.has(s.fingerprint)) continue;
    if (s.status !== "open") continue;
    if (!ranDetectors.has(s.detector)) continue;
    const quietMs = now.getTime() - s.lastSeen.getTime();
    if (quietMs < DETECTORS[s.detector].resolveAfterMinutes * 60_000) continue;
    plan.resolves.push({
      id: s.id,
      stored: s,
      alert: s.lastAlertedAt ? "resolved" : null,
    });
  }

  // Event-fund der er set igen pga. overlap uden nye forekomster: kun den
  // tidsbaserede løsning ovenfor gælder — de står i updates med
  // touchLastSeen=false og må også løses, når de har været stille længe nok.
  for (const u of plan.updates) {
    if (u.touchLastSeen) continue;
    const s = byFingerprint.get(u.finding.fingerprint);
    if (s?.status !== "open") continue;
    const quietMs = now.getTime() - s.lastSeen.getTime();
    if (quietMs >= DETECTORS[s.detector].resolveAfterMinutes * 60_000) {
      plan.resolves.push({
        id: s.id,
        stored: s,
        alert: s.lastAlertedAt ? "resolved" : null,
      });
    }
  }
  const resolvedIds = new Set(plan.resolves.map((r) => r.id));
  plan.updates = plan.updates.filter((u) => !resolvedIds.has(u.id));

  return plan;
}

// ─── Beskeder ─────────────────────────────────────────────────────────────

export interface TrailEvent {
  createdAt: Date;
  event: string;
  source: string;
  clientHint: string | null;
  startTime: Date | null;
  versionAfter: number | null;
  /** Kun til admin-visning — sendes aldrig til Discord */
  clientName: string | null;
  clientId: string | null;
}

const dkTime = new Intl.DateTimeFormat("da-DK", {
  timeZone: "Europe/Copenhagen",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatDanishTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "–";
  return dkTime.format(d);
}

export const ALERT_TITLES: Record<AlertKind, string> = {
  new: "Nyt stabilitetsfund",
  recurred: "Stabilitetsfund er tilbage",
  reminder: "Stabilitetsfund står stadig på",
  resolved: "Stabilitetsfund løst",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "KRITISK",
  warning: "Advarsel",
  info: "Info",
};

export const DISCORD_DESCRIPTION_LIMIT = 4000;
/** Discord: embed-titel højst 256 tegn */
export const DISCORD_TITLE_LIMIT = 250;

/** Klip en tekst til højst `limit` tegn, med "…" som markør. */
export function truncateForDiscord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

export function formatAlertDescription(params: {
  kind: AlertKind;
  detector: DetectorId;
  severity: Severity;
  title: string;
  who: string | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  trail: TrailEvent[];
  adminUrl: string;
  userUrl: string | null;
  runbookUrl: string;
  environment: string;
}): string {
  const cfg = DETECTORS[params.detector];
  const lines = [
    `**${SEVERITY_LABEL[params.severity]} · ${cfg.label}** (\`${params.detector}\`)`,
    params.title,
    "",
    `**Hvem:** ${params.who ?? "system"}`,
    `**Antal:** ${params.count} · **Først set:** ${formatDanishTime(params.firstSeen)} · **Sidst set:** ${formatDanishTime(params.lastSeen)}`,
    `**Miljø:** ${params.environment}`,
  ];
  if (params.kind !== "resolved" && params.trail.length > 0) {
    lines.push("", "**Timer-spor (dansk tid, nyeste nederst):**", "```");
    for (const e of params.trail) {
      lines.push(
        [
          formatDanishTime(e.createdAt),
          e.event.padEnd(20),
          `${e.source}/${e.clientHint ?? "?"}`,
          e.startTime ? `start ${formatDanishTime(e.startTime)}` : "",
          // Kun id-præfiks: kundens kunders navne hører ikke til i Discord
          e.clientId ? `kunde ${e.clientId.slice(0, 8)}` : "",
          e.versionAfter !== null ? `v${e.versionAfter}` : "",
        ]
          .filter(Boolean)
          .join("  "),
      );
    }
    lines.push("```");
  }
  lines.push(
    "",
    `[Admin: stabilitet](${params.adminUrl})${params.userUrl ? ` · [Timerlog](${params.userUrl})` : ""} · [Runbook](${params.runbookUrl})`,
  );
  let text = lines.join("\n");
  if (text.length > DISCORD_DESCRIPTION_LIMIT) {
    // Klip i sporet, behold links nederst
    const tail = lines.slice(-2).join("\n");
    text = `${text.slice(0, DISCORD_DESCRIPTION_LIMIT - tail.length - 10)}\n…\`\`\`\n${tail}`;
  }
  return text;
}
