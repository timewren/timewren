"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Info,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import {
  DETECTOR_IDS,
  DETECTORS,
  type DetectorId,
  type Severity,
} from "@/lib/stability/detectors";
import { TIMER_REJECTION_EVENTS } from "@/lib/timer/event-names";
import { trpc } from "@/providers/trpc-provider";

const RUNBOOK_URL =
  "https://github.com/mahope/timetrack/blob/main/docs/runbooks/timer-fejlsoegning.md";

type Status = "open" | "resolved" | "ignored";

const STATUS_TABS: { id: Status; label: string }[] = [
  { id: "open", label: "Åbne" },
  { id: "resolved", label: "Løste" },
  { id: "ignored", label: "Ignorerede" },
];

const SEVERITY_META: Record<
  Severity,
  { label: string; className: string; icon: typeof Info }
> = {
  critical: {
    label: "Kritisk",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    icon: ShieldAlert,
  },
  warning: {
    label: "Advarsel",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    icon: AlertTriangle,
  },
  info: {
    label: "Info",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    icon: Info,
  },
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const timeFmt = new Intl.DateTimeFormat("da-DK", {
  timeZone: "Europe/Copenhagen",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function fmt(value: Date | string | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "–" : timeFmt.format(d);
}

function detectorLabel(id: string): string {
  return DETECTORS[id as DetectorId]?.label ?? id;
}

function SeverityBadge({ severity }: { severity: string }) {
  const meta = SEVERITY_META[severity as Severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

function Trail({ findingId }: { findingId: string }) {
  const { data, isLoading, error } = trpc.admin.stability.trail.useQuery({
    findingId,
  });
  if (isLoading) return <InlineSpinner />;
  if (error)
    return (
      <p className="text-xs text-red-600">
        Sporet kunne ikke hentes: {error.message}
      </p>
    );
  if (!data || data.length === 0)
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Ingen timer-hændelser i fundets periode.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400">
            <th className="py-1 pr-3 font-medium">Tid (dansk)</th>
            <th className="py-1 pr-3 font-medium">Hændelse</th>
            <th className="py-1 pr-3 font-medium">Kilde</th>
            <th className="py-1 pr-3 font-medium">Timerstart</th>
            <th className="py-1 pr-3 font-medium">Kunde</th>
            <th className="py-1 pr-3 font-medium">Version</th>
            <th className="py-1 font-medium">Detaljer</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {data.map((e) => {
            const rejected = TIMER_REJECTION_EVENTS.has(
              e.event as Parameters<typeof TIMER_REJECTION_EVENTS.has>[0],
            );
            return (
              <tr key={e.id}>
                <td className="py-1 pr-3 tabular-nums text-gray-600 dark:text-gray-300">
                  {fmt(e.createdAt)}
                </td>
                <td
                  className={`py-1 pr-3 font-mono ${rejected ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-200"}`}
                >
                  {e.event}
                </td>
                <td className="py-1 pr-3 text-gray-600 dark:text-gray-300">
                  {e.source}
                  {e.clientHint ? ` · ${e.clientHint}` : ""}
                </td>
                <td className="py-1 pr-3 tabular-nums text-gray-600 dark:text-gray-300">
                  {fmt(e.startTime)}
                </td>
                <td className="py-1 pr-3 text-gray-600 dark:text-gray-300">
                  {e.clientName ?? "–"}
                </td>
                <td className="py-1 pr-3 tabular-nums text-gray-600 dark:text-gray-300">
                  {e.versionBefore ?? "–"} → {e.versionAfter ?? "–"}
                </td>
                <td className="max-w-xs truncate py-1 font-mono text-gray-500 dark:text-gray-400">
                  {e.detail ? JSON.stringify(e.detail) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  web: "Web (fane)",
  pwa: "Web (installeret app)",
  extension: "Browserudvidelse",
  mobile: "Mobilapp",
  desktop: "Desktop",
  api: "API",
  mcp: "MCP",
  ukendt: "Ukendt",
};

const VERSION_STATUS: Record<string, { label: string; className: string }> = {
  ok: {
    label: "OK",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  below: {
    label: "Under minimum",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  unknown: {
    label: "Uden version",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

/** Klienttyper og -versioner der har skrevet de seneste 7 dage. */
function ClientVersions() {
  const { data, isLoading, error } =
    trpc.admin.stability.clientVersions.useQuery(undefined, {
      refetchInterval: 5 * 60_000,
    });
  const minimums = Object.entries(data?.minimums ?? {});
  return (
    <section
      aria-labelledby="client-versions-heading"
      className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="client-versions-heading"
          className="text-sm font-semibold text-gray-900 dark:text-white"
        >
          Klientversioner (7 dage)
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Minimum:{" "}
          {minimums.length === 0
            ? "ingen (MIN_CLIENT_VERSIONS er tom)"
            : minimums.map(([k, v]) => `${k} ${v}`).join(", ")}
          {minimums.length > 0 && data && !data.enforced
            ? " · kun observation"
            : ""}
        </p>
      </div>
      {isLoading ? (
        <div className="py-3">
          <InlineSpinner />
        </div>
      ) : error ? (
        <p className="py-3 text-sm text-red-600">
          Versioner kunne ikke hentes: {error.message}
        </p>
      ) : !data || data.rows.length === 0 ? (
        <p className="py-3 text-sm text-gray-500 dark:text-gray-400">
          Ingen timer-skrivninger de seneste 7 dage.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400">
                <th className="py-1 pr-3 font-medium">Klient</th>
                <th className="py-1 pr-3 font-medium">Version</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 text-right font-medium">Hændelser</th>
                <th className="py-1 pr-3 text-right font-medium">Afvist</th>
                <th className="py-1 pr-3 text-right font-medium">Brugere</th>
                <th className="py-1 font-medium">Sidst set</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.rows.map((r) => {
                const st = VERSION_STATUS[r.status] ?? VERSION_STATUS.unknown;
                return (
                  <tr key={`${r.kind}|${r.version ?? ""}`}>
                    <td className="py-1 pr-3 text-gray-800 dark:text-gray-200">
                      {KIND_LABELS[r.kind] ?? r.kind}
                    </td>
                    <td className="py-1 pr-3 font-mono text-gray-700 dark:text-gray-300">
                      {r.version ??
                        (r.kind === "extension"
                          ? "≤ 2.5.1 (uden header)"
                          : "–")}
                    </td>
                    <td className="py-1 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.className}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {r.writes.toLocaleString("da-DK")}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {r.rejected.toLocaleString("da-DK")}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {r.users}
                    </td>
                    <td className="py-1 tabular-nums text-gray-600 dark:text-gray-300">
                      {fmt(r.lastAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Brugere er det højeste antal på én browser/enhedstype, ikke en
            distinkt sum. Hæv først minimummet, når ingen aktive brugere står
            under det — se runbooken (afsnit j).
          </p>
        </div>
      )}
    </section>
  );
}

export default function StabilityPage() {
  const [status, setStatus] = useState<Status>("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // Link fra Discord: ?fund=<id> folder fundet ud
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("fund");
    if (id) setExpanded(id);
  }, []);

  const counters = trpc.admin.stability.counters.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const list = trpc.admin.stability.list.useQuery(
    { status },
    { refetchInterval: 60_000 },
  );

  const invalidate = () => {
    utils.admin.stability.list.invalidate();
    utils.admin.stability.counters.invalidate();
  };
  const resolve = trpc.admin.stability.resolve.useMutation({
    onSuccess: () => {
      toast.success("Markeret som løst");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const ignore = trpc.admin.stability.ignore.useMutation({
    onSuccess: () => {
      toast.success("Fundet ignoreres fremover");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const countersByDetector = new Map(
    (counters.data ?? []).map((c) => [c.detector, c]),
  );
  const rows = [...(list.data ?? [])].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Stabilitet
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Stabilitetsvagten kører hvert 15. minut og leder efter timer- og
            datafejl, før kunderne melder dem. Advarsler og kritiske fund sendes
            til Discord og Sentry.{" "}
            <a
              href={RUNBOOK_URL}
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline dark:text-brand-400"
            >
              Runbook
            </a>
          </p>
        </div>
        <button
          type="button"
          onClick={invalidate}
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Opdatér
        </button>
      </div>

      {/* Tællere pr. detektor */}
      <section aria-labelledby="counters-heading">
        <h2 id="counters-heading" className="sr-only">
          Fund pr. detektor
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {DETECTOR_IDS.map((id) => {
            const c = countersByDetector.get(id);
            const open = c?.open ?? 0;
            return (
              <div
                key={id}
                className={`rounded-lg border p-3 ${open > 0 ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"}`}
              >
                <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  {DETECTORS[id].label}
                </p>
                <p className="mt-1 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                  <span className="text-base font-semibold text-gray-900 dark:text-white">
                    {open}
                  </span>{" "}
                  åbne · {c?.last24h ?? 0} nye/24 t · {c?.last7d ?? 0}/7 d
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <ClientVersions />

      {/* Fundliste */}
      <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div
          role="tablist"
          aria-label="Status"
          className="flex gap-1 border-b border-gray-200 px-3 pt-2 dark:border-gray-800"
        >
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={status === t.id}
              onClick={() => setStatus(t.id)}
              className={`min-h-9 border-b-2 px-3 text-sm font-medium ${status === t.id ? "border-brand-600 dark:border-brand-400 text-brand-700 dark:text-brand-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {list.isLoading ? (
          <div className="p-6">
            <InlineSpinner />
          </div>
        ) : list.error ? (
          <p className="p-6 text-sm text-red-600">
            Fund kunne ikke hentes: {list.error.message}
          </p>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-gray-500 dark:text-gray-400">
            <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
            {status === "open"
              ? "Ingen åbne fund. Alt ser stabilt ud."
              : "Ingen fund her."}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((f) => {
              const isOpen = expanded === f.id;
              const anchor =
                DETECTORS[f.detector as DetectorId]?.runbookAnchor ?? "";
              return (
                <li key={f.id} className="p-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : f.id)}
                      aria-expanded={isOpen}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown
                          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                          aria-hidden
                        />
                      ) : (
                        <ChevronRight
                          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={f.severity} />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {detectorLabel(f.detector)}
                          </span>
                          {f.userId && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {f.userName || f.userEmail || f.userId}
                              {f.organizationName
                                ? ` · ${f.organizationName}`
                                : ""}
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-sm text-gray-700 dark:text-gray-300">
                          {f.title}
                        </span>
                        <span className="mt-1 block text-xs tabular-nums text-gray-500 dark:text-gray-400">
                          {f.count}× · først {fmt(f.firstSeen)} · sidst{" "}
                          {fmt(f.lastSeen)}
                          {f.resolvedAt
                            ? ` · løst ${fmt(f.resolvedAt)}${f.resolvedBy === "auto" ? " (automatisk)" : ""}`
                            : ""}
                        </span>
                      </span>
                    </button>
                    {status !== "resolved" && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={resolve.isPending}
                          onClick={() => resolve.mutate({ id: f.id })}
                          className="inline-flex min-h-9 items-center gap-1 rounded-md bg-green-600 px-3 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          Markér løst
                        </button>
                        {status === "open" && (
                          <button
                            type="button"
                            disabled={ignore.isPending}
                            onClick={() => ignore.mutate({ id: f.id })}
                            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            <EyeOff className="h-3.5 w-3.5" aria-hidden />
                            Ignorér
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isOpen && (
                    <div className="mt-3 space-y-3 pl-6">
                      <div className="flex flex-wrap gap-3 text-xs">
                        {f.userId && (
                          <Link
                            href={`/admin/users/${f.userId}?tab=timerlog`}
                            className="text-brand-600 hover:underline dark:text-brand-400"
                          >
                            Brugerens timerlog
                          </Link>
                        )}
                        <a
                          href={`${RUNBOOK_URL}#${anchor}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-600 hover:underline dark:text-brand-400"
                        >
                          Runbook for {f.detector}
                        </a>
                        <span className="font-mono text-gray-400">
                          {f.fingerprint}
                        </span>
                      </div>
                      {f.resolutionNote && (
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                          Note: {f.resolutionNote}
                        </p>
                      )}
                      <details>
                        <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">
                          Eksempler (JSON)
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-950 dark:text-gray-300">
                          {JSON.stringify(f.sample, null, 2)}
                        </pre>
                      </details>
                      {f.userId && <Trail findingId={f.id} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
