"use client";

import { Clock, Download, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getPortalPath, useCustomDomain } from "@/hooks/useCustomDomain";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { downloadCSV } from "@/lib/utils/csv-export";
import { trpc } from "@/providers/trpc-provider";
import {
  PortalEmpty,
  PortalLoading,
  PortalQueryError,
  PortalShell,
  portalBadge,
  portalTable,
  usePortalFormat,
} from "../_components/PortalShell";

const PRESET_KEYS = [
  "all",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "last30Days",
  "last90Days",
] as const;

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white";

export default function PortalTimeReportPage() {
  const t = useTranslations("portal.report");
  const f = usePortalFormat();
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const router = useRouter();
  const { isCustomDomain } = useCustomDomain();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>("");

  // Periode — standard er HELE perioden (tom fra-dato = intet nedre filter).
  // Kunder med klippekort vil se alt forbrug på kortet, ikke kun denne uge
  // eller måned, så det totale billede matcher saldoen på kortet.
  const today = new Date();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(() => toLocalDateStr(today));
  // Hvilken hurtigperiode er aktiv (tom = manuelt valgte datoer)
  const [activePreset, setActivePreset] = useState("all");

  useEffect(() => {
    const token = localStorage.getItem("portalSession");
    if (!token) {
      router.push(getPortalPath("/portal/login", isCustomDomain));
      return;
    }
    setSessionToken(token);
  }, [router, isCustomDomain]);

  const {
    data: session,
    isLoading: isValidating,
    isError: sessionError,
  } = trpc.publicPortal.validateSession.useQuery(
    { sessionToken: sessionToken || "" },
    { enabled: !!sessionToken, retry: false },
  );

  useEffect(() => {
    if (sessionError || (session && !session.valid)) {
      localStorage.removeItem("portalSession");
      router.push(getPortalPath("/portal/login", isCustomDomain));
    }
  }, [sessionError, session, router, isCustomDomain]);

  const {
    data: report,
    isLoading,
    isError: reportError,
    refetch,
  } = trpc.publicPortal.getTimeReport.useQuery(
    {
      sessionToken: sessionToken || "",
      startDate: startDate || undefined,
      endDate,
      projectId: selectedProject || undefined,
    },
    { enabled: !!sessionToken && session?.valid },
  );

  const { data: projects } = trpc.publicPortal.getProjects.useQuery(
    { sessionToken: sessionToken || "" },
    {
      enabled:
        !!sessionToken &&
        !!session?.valid &&
        !!session?.access?.permissions?.canViewProjects,
    },
  );

  const formatHours = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h === 0) return t("minutesOnly", { m });
    if (m === 0) return t("hoursOnly", { h });
    return t("hoursMinutes", { h, m });
  };

  const formatDate = (dateStr: string): string =>
    new Date(dateStr).toLocaleDateString(intlLocale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

  const setDatePreset = (preset: string) => {
    const now = new Date();
    let start: Date;
    let end: Date = now;

    // ISO-uge (mandag–søndag): getDay() er 0 om søndagen, så den naive
    // "getDay()-1" pegede på NÆSTE uges mandag og gav en tom rapport.
    const daysSinceMonday = (now.getDay() + 6) % 7;
    setActivePreset(preset);
    switch (preset) {
      case "all":
        setStartDate("");
        setEndDate(toLocalDateStr(now));
        return;
      case "thisWeek":
        start = new Date(now);
        start.setDate(now.getDate() - daysSinceMonday);
        break;
      case "lastWeek":
        start = new Date(now);
        start.setDate(now.getDate() - daysSinceMonday - 7);
        end = new Date(now);
        end.setDate(now.getDate() - daysSinceMonday - 1);
        break;
      case "thisMonth":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "lastMonth":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case "last30Days":
        start = new Date(now);
        start.setDate(now.getDate() - 30);
        break;
      case "last90Days":
        start = new Date(now);
        start.setDate(now.getDate() - 90);
        break;
      default:
        return;
    }

    setStartDate(toLocalDateStr(start));
    setEndDate(toLocalDateStr(end));
  };

  /** CSV til kundens eget regneark — semikolon (downloadCSV sætter selv BOM til Excel). */
  const exportCsv = () => {
    if (!report) return;
    // Beskrivelser er fri tekst: neutralisér regneark-formler (=, +, -, @).
    const cell = (v: string | number) => {
      const s = String(v ?? "");
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [
      [
        t("colDate"),
        t("colProject"),
        t("colDescription"),
        t("colHours"),
        t("colStatus"),
      ],
      ...report.entries.map((e) => [
        new Date(e.date).toLocaleDateString(intlLocale),
        e.projectName || "",
        e.description || "",
        locale === "en"
          ? Number.parseFloat(e.hours).toFixed(2)
          : Number.parseFloat(e.hours).toFixed(2).replace(".", ","),
        e.isPrepaid
          ? t("statusPrepaid")
          : e.isBilled
            ? t("statusBilled")
            : t("statusNotBilled"),
      ]),
    ];
    const csv = rows.map((r) => r.map(cell).join(";")).join("\r\n");
    downloadCSV(
      csv,
      `${t("csvFilename")}_${startDate || "start"}_${endDate}.csv`,
    );
  };

  if (!sessionToken || isValidating) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <PortalLoading label={t("validating")} />
      </div>
    );
  }

  if (!session?.valid || !session.access) {
    return null;
  }

  const { access, branding } = session;
  const canView = !!access.permissions.canViewTimeEntries;

  return (
    <PortalShell
      sessionToken={sessionToken}
      clientName={access.clientName}
      branding={branding}
      permissions={access.permissions}
      active="time-report"
    >
      {!canView ? (
        <PortalEmpty
          icon={FileText}
          title={t("noAccessTitle")}
          text={t("noAccessText")}
        />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t("title")}
              </h1>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {t("subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!report || report.entries.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Download className="h-3.5 w-3.5" />
              {t("csv")}
            </button>
          </div>

          {/* Filtre */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {PRESET_KEYS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDatePreset(preset)}
                  aria-pressed={preset === activePreset}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    preset === activePreset
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  }`}
                >
                  {t(`presets.${preset}`)}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label
                  htmlFor="startDate"
                  className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("from")}
                </label>
                <input
                  type="date"
                  id="startDate"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setActivePreset("");
                  }}
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="endDate"
                  className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("to")}
                </label>
                <input
                  type="date"
                  id="endDate"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setActivePreset("");
                  }}
                  className={inputClass}
                />
              </div>
              {projects && projects.length > 0 && (
                <div className="lg:col-span-2">
                  <label
                    htmlFor="project"
                    className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("project")}
                  </label>
                  <select
                    id="project"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className={`${inputClass} appearance-none pr-8`}
                  >
                    <option value="">{t("allProjects")}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {isLoading && <PortalLoading />}
          {reportError && <PortalQueryError onRetry={() => void refetch()} />}

          {report && !isLoading && (
            <>
              {/* Nøgletal */}
              <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-gray-200 sm:grid-cols-3 dark:bg-gray-800">
                <div className="bg-white p-4 dark:bg-gray-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("totalHours")}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                    {formatHours(report.summary.totalHours)}
                  </div>
                </div>
                <div className="bg-white p-4 dark:bg-gray-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("billed")}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                    {formatHours(report.summary.billedHours)}
                  </div>
                  {report.summary.prepaidHours > 0 && (
                    <div className="mt-0.5 text-xs text-brand-700 dark:text-brand-300">
                      {t("viaPrepaid", {
                        hours: formatHours(report.summary.prepaidHours),
                      })}
                    </div>
                  )}
                </div>
                <div className="bg-white p-4 dark:bg-gray-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("entries")}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                    {report.summary.entriesCount}
                  </div>
                </div>
              </div>

              {/* Timer pr. projekt */}
              {report.byProject.length > 1 && (
                <div className="rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                    {t("hoursPerProject")}
                  </h2>
                  <div className="space-y-3">
                    {report.byProject.map((project) => {
                      const percentage =
                        report.summary.totalHours > 0
                          ? (project.hours / report.summary.totalHours) * 100
                          : 0;
                      return (
                        <div key={project.projectId}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-medium text-gray-900 dark:text-white">
                              {project.projectName}
                            </span>
                            <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                              <span className="tabular-nums text-gray-900 dark:text-white">
                                {formatHours(project.hours)}
                              </span>{" "}
                              ·{" "}
                              {t("entriesCount", {
                                count: project.entriesCount,
                              })}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                            <div
                              className="h-1.5 rounded-full bg-brand-500 transition-all duration-500"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {report.entries.length === 0 ? (
                <PortalEmpty
                  icon={Clock}
                  title={t("emptyTitle")}
                  text={t("emptyText")}
                />
              ) : (
                <div className={portalTable.wrap}>
                  <table className={portalTable.table}>
                    <thead>
                      <tr className={portalTable.headRow}>
                        <th className={portalTable.th}>{t("colDate")}</th>
                        <th
                          className={`${portalTable.th} hidden sm:table-cell`}
                        >
                          {t("colProject")}
                        </th>
                        <th className={portalTable.th}>
                          {t("colDescription")}
                        </th>
                        <th className={portalTable.thRight}>{t("colHours")}</th>
                        <th className={portalTable.thRight}>
                          {t("colStatus")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.entries.map((entry) => (
                        <tr key={entry.id} className={portalTable.row}>
                          <td className={`${portalTable.td} whitespace-nowrap`}>
                            {formatDate(entry.date)}
                          </td>
                          <td
                            className={`${portalTable.tdMuted} hidden sm:table-cell`}
                          >
                            {entry.projectName || "–"}
                          </td>
                          <td className={`${portalTable.tdMuted} max-w-xs`}>
                            <span className="line-clamp-1">
                              {entry.description || "–"}
                            </span>
                          </td>
                          <td
                            className={`${portalTable.tdNum} whitespace-nowrap`}
                          >
                            {f.hours(entry.hours)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">
                            {/* Timer trukket på klippekort er allerede betalt —
                                "Ikke faktureret" ville forvirre kunden. */}
                            {entry.isPrepaid ? (
                              <span className={portalBadge.purple}>
                                {t("statusPrepaid")}
                              </span>
                            ) : entry.isBilled ? (
                              <span className={portalBadge.green}>
                                {t("statusBilled")}
                              </span>
                            ) : (
                              <span className={portalBadge.amber}>
                                {t("statusNotBilled")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={portalTable.foot}>
                        <td className="px-4 py-2 sm:hidden" colSpan={2}>
                          {t("entriesCount", {
                            count: report.summary.entriesCount,
                          })}
                        </td>
                        <td
                          className="hidden px-4 py-2 sm:table-cell"
                          colSpan={3}
                        >
                          {t("entriesCount", {
                            count: report.summary.entriesCount,
                          })}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {t("hoursShort", {
                            hours: f.hours(report.summary.totalHours),
                          })}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </PortalShell>
  );
}
