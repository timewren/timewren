import {
  type ClientKind,
  classifyClientHint,
  compareVersions,
  evaluateClientVersion,
  LEGACY_EXTENSION_VERSION,
  type MinClientVersions,
} from "./index";

/**
 * Fordeling af klienttyper/-versioner ud fra timer_events.client_hint —
 * vises på /admin/stabilitet, så man kan se hvem der stadig kører en gammel
 * version, før minimummet hæves.
 */

export interface HintCountRow {
  clientHint: string | null;
  source: string;
  writes: number;
  rejected: number;
  users: number;
  lastAt: Date | null;
}

export type DistributionStatus = "ok" | "below" | "unknown";

export interface DistributionRow {
  kind: ClientKind | "ukendt";
  /** null = klienten sendte ingen versionsheader */
  version: string | null;
  status: DistributionStatus;
  writes: number;
  rejected: number;
  /** Største antal brugere på én hint-række (ikke en distinkt sum) */
  users: number;
  lastAt: Date | null;
}

const KIND_FROM_SOURCE: Partial<Record<string, ClientKind>> = {
  web: "web",
  extension: "extension",
  mobile: "mobile",
  desktop: "desktop",
};

export function summarizeClientVersions(
  rows: HintCountRow[],
  minimums: MinClientVersions,
): DistributionRow[] {
  const byKey = new Map<string, DistributionRow>();
  for (const r of rows) {
    const parsed = classifyClientHint(r.clientHint);
    const kind: ClientKind | "ukendt" =
      parsed.kind ?? KIND_FROM_SOURCE[r.source] ?? "ukendt";
    const version = parsed.version;
    let status: DistributionStatus = "unknown";
    if (r.rejected > 0) {
      status = "below";
    } else if (kind !== "ukendt") {
      const effective =
        kind === "extension" && !version ? LEGACY_EXTENSION_VERSION : version;
      const verdict = evaluateClientVersion(
        { kind, version: effective, declared: !!version },
        minimums,
      );
      if (verdict.status === "too_old") status = "below";
      else if (version && verdict.status === "ok") status = "ok";
    }
    const key = `${kind}|${version ?? ""}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        kind,
        version,
        status,
        writes: r.writes,
        rejected: r.rejected,
        users: r.users,
        lastAt: r.lastAt,
      });
      continue;
    }
    prev.writes += r.writes;
    prev.rejected += r.rejected;
    prev.users = Math.max(prev.users, r.users);
    if (status === "below") prev.status = "below";
    if (r.lastAt && (!prev.lastAt || r.lastAt > prev.lastAt)) {
      prev.lastAt = r.lastAt;
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.version && b.version) {
      return (
        -(compareVersions(a.version, b.version) ?? 0) ||
        b.version.localeCompare(a.version)
      );
    }
    return a.version ? -1 : b.version ? 1 : 0;
  });
}
