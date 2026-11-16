"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatTotal } from "@/lib/enterprise/timesheet";
import {
  addDays,
  isoWeekNumber,
  parseISOWeekString,
  startOfISOWeek,
  toDateStr,
  toISOWeekString,
} from "@/lib/enterprise/week";
import { trpc } from "@/providers/trpc-provider";
import { BalanceChips } from "./BalanceChips";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function CompletenessBadge({
  completeness,
}: {
  completeness: "complete" | "incomplete" | "empty";
}) {
  const t = useTranslations("enterprise.team");
  if (completeness === "complete") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> {t("complete")}
      </span>
    );
  }
  if (completeness === "incomplete") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> {t("incomplete")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 dark:text-gray-500">
      <XCircle className="h-3.5 w-3.5" /> {t("notFilled")}
    </span>
  );
}

function FlowBadge({ status }: { status: string | null }) {
  const t = useTranslations("enterprise.team");
  const tc = useTranslations("enterpriseCommon");
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
        {tc("weekStatus.approved")}
      </span>
    );
  }
  if (status === "submitted") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-800 dark:bg-tt-gran-lys dark:text-brand-300">
        <Clock className="h-3 w-3" /> {t("pending")}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
        {tc("weekStatus.rejected")}
      </span>
    );
  }
  if (status === "reopened") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        <RotateCcw className="h-3 w-3" /> {tc("weekStatus.reopened")}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
      {tc("weekStatus.draft")}
    </span>
  );
}

const EVENT_DOT: Record<string, string> = {
  submitted: "bg-blue-500",
  approved: "bg-green-500",
  rejected: "bg-red-500",
  reopened: "bg-amber-500",
};

/**
 * Ugens hændelser for én medarbejder (#466): indsendt/godkendt/afvist/
 * genåbnet med aktør og tidspunkt — lille tidslinje under rækken.
 */
function WeekEventsTimeline({
  userId,
  weekStart,
}: {
  userId: string;
  weekStart: string;
}) {
  const t = useTranslations("enterprise.team");
  const tc = useTranslations("enterpriseCommon");
  const intlLocale = toIntlLocale(useLocale());
  const { data, isLoading } = trpc.enterprise.getTimesheetWeekEvents.useQuery({
    userId,
    weekStart,
  });
  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-gray-500">
        <InlineSpinner /> {t("loadingEvents")}
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
        {t("noEvents")}
      </p>
    );
  }
  return (
    <ol className="space-y-1.5 px-4 py-3">
      {data.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-xs">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${EVENT_DOT[e.event] ?? "bg-gray-400"}`}
          />
          <span className="font-medium text-gray-900 dark:text-white">
            {["submitted", "approved", "rejected", "reopened"].includes(e.event)
              ? tc(`weekStatus.${e.event}`)
              : e.event}
          </span>
          <span className="text-gray-600 dark:text-gray-400">
            {t("eventBy", {
              name:
                e.actor?.name ??
                e.actor?.email ??
                e.actorLabel ??
                t("unknownActor"),
            })}
          </span>
          <time
            dateTime={new Date(e.createdAt).toISOString()}
            className="text-gray-500 dark:text-gray-400"
          >
            {new Date(e.createdAt).toLocaleString(intlLocale, {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          {e.totalHours && (
            <span className="text-gray-500 dark:text-gray-400">
              · {t("hoursValue", { value: formatTotal(Number(e.totalHours)) })}
            </span>
          )}
          {e.reason && (
            <span className="text-gray-600 italic dark:text-gray-400">
              · {e.reason}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function TeamPageContent() {
  const t = useTranslations("enterprise.team");
  const tDays = useTranslations("team.days");
  const intlLocale = toIntlLocale(useLocale());
  const router = useRouter();
  const searchParams = useSearchParams();
  const [weekStart, setWeekStartState] = useState(
    () =>
      parseISOWeekString(searchParams.get("week")) ??
      startOfISOWeek(addDays(new Date(), -7)),
  );
  const weekStartStr = toDateStr(weekStart);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** Skift uge og spejl den i URL'en (?week=YYYY-Www) så links kan deles. */
  function setWeekStart(next: Date) {
    setWeekStartState(next);
    // Markeringen gælder kun den viste uge — ellers kunne "Godkend valgte"
    // ramme medarbejdere der ikke er indsendt i den nye uge (#452).
    setSelected(new Set());
    router.replace(`/dashboard/enterprise/team?week=${toISOWeekString(next)}`, {
      scroll: false,
    });
  }
  const [rejecting, setRejecting] = useState<string | null>(null);
  // Genåbning kræver en årsag (#518) — logges i hændelsesloggen
  const [reopening, setReopening] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  // Udfoldet hændelsestidslinje (#466) — én medarbejder ad gangen
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  // Afdelingsfilter (#464) — "" = alle afdelinger i eget scope
  const [departmentId, setDepartmentId] = useState("");
  // Manglende timesedler (#467): kladde/afvist/genåbnet = ikke indsendt for ugen
  const [onlyMissing, setOnlyMissing] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading, error } =
    trpc.enterprise.getTeamWeekOverview.useQuery({
      weekStart: weekStartStr,
      departmentId: departmentId || undefined,
    });
  const { data: departments } = trpc.enterprise.listDepartments.useQuery();
  // Saldi (ferie/feriefridage/flex/afspadsering) pr. medarbejder — separat
  // batch-query så ugelisten ikke venter på den
  const { data: balances } = trpc.enterprise.getTeamWeekBalances.useQuery({
    weekStart: weekStartStr,
    departmentId: departmentId || undefined,
  });
  const balanceByUser = useMemo(
    () => new Map((balances?.members ?? []).map((b) => [b.userId, b])),
    [balances],
  );

  const invalidate = () => {
    utils.enterprise.getTeamWeekOverview.invalidate();
    utils.enterprise.getTeamWeekBalances.invalidate();
    utils.enterprise.getTimesheetWeekEvents.invalidate();
  };

  const approveDepartment = trpc.enterprise.approveDepartmentWeek.useMutation({
    onSuccess: (r) => {
      invalidate();
      setSelected(new Set());
      if (r.approved.length === 0 && r.failed.length === 0) {
        toast.info(t("noneToApprove"));
      } else if (r.approved.length > 0) {
        toast.success(t("weeksApproved", { count: r.approved.length }));
      }
      for (const f of r.failed.slice(0, 3)) {
        toast.error(`${f.name}: ${f.message}`);
      }
    },
    onError: (e) => toast.error(e.message || t("approveFailed")),
  });

  const approve = trpc.enterprise.approveTimesheetWeek.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("weekApproved"));
    },
    onError: (e) => toast.error(e.message || t("approveFailed")),
  });

  const reject = trpc.enterprise.rejectTimesheetWeek.useMutation({
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      setRejectReason("");
      toast.success(t("weekRejected"));
    },
    onError: (e) => toast.error(e.message || t("rejectFailed")),
  });

  const reopen = trpc.enterprise.reopenTimesheetWeek.useMutation({
    onSuccess: () => {
      invalidate();
      setReopening(null);
      setReopenReason("");
      toast.success(t("weekReopened"));
    },
    onError: (e) => toast.error(e.message || t("reopenFailed")),
  });

  const allMembers = data?.members ?? [];
  const days = data?.days ?? [];
  const missingMembers = useMemo(
    () =>
      allMembers.filter(
        (m) =>
          m.weekStatus === null ||
          m.weekStatus === "rejected" ||
          m.weekStatus === "reopened",
      ),
    [allMembers],
  );
  const members = onlyMissing ? missingMembers : allMembers;

  // Batch: kun komplette + afventende uger kan vælges
  const selectable = useMemo(
    () =>
      members.filter(
        (m) => m.weekStatus === "submitted" && m.completeness === "complete",
      ),
    [members],
  );

  async function approveSelected() {
    const ids = Array.from(selected);
    for (const userId of ids) {
      try {
        await approve.mutateAsync({ userId, weekStart: weekStartStr });
      } catch {
        // toast håndteret i onError
      }
    }
    setSelected(new Set());
  }

  const weekLabel = t("weekLabel", {
    week: isoWeekNumber(weekStart),
    from: weekStart.toLocaleDateString(intlLocale, {
      day: "numeric",
      month: "short",
    }),
    to: addDays(weekStart, 6).toLocaleDateString(intlLocale, {
      day: "numeric",
      month: "short",
    }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            aria-label={t("prevWeek")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setWeekStart(startOfISOWeek(addDays(new Date(), -7)))
            }
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t("lastWeek")}
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            aria-label={t("nextWeek")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <CalendarDays className="h-4 w-4 text-gray-400" />
            {weekLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {departments && departments.length > 0 && (
            <select
              value={departmentId}
              aria-label={t("department")}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setSelected(new Set());
              }}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              <option value="">{t("allDepartments")}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          {departmentId && (
            <button
              type="button"
              onClick={() =>
                approveDepartment.mutate({
                  departmentId,
                  weekStart: weekStartStr,
                })
              }
              disabled={approveDepartment.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20"
            >
              <Check className="h-4 w-4" />
              {t("approveDepartment")}
            </button>
          )}
          {!isLoading && allMembers.length > 0 && (
            <button
              type="button"
              onClick={() => setOnlyMissing((v) => !v)}
              aria-pressed={onlyMissing}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                missingMembers.length > 0
                  ? onlyMissing
                    ? "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200"
                    : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                  : "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
              }`}
              title={t("onlyMissingTitle")}
            >
              {missingMembers.length > 0 ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {missingMembers.length > 0
                ? t("missingCount", {
                    count: missingMembers.length,
                    week: isoWeekNumber(weekStart),
                  })
                : t("allSubmitted", { week: isoWeekNumber(weekStart) })}
            </button>
          )}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={approveSelected}
              disabled={approve.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {t("approveSelected", { count: selected.size })}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error.message}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <InlineSpinner />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="w-8 px-3 py-3">
                  <span className="sr-only">{t("select")}</span>
                </th>
                <th className="px-3 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                  {t("colEmployee")}
                </th>
                {days.map((dateStr, i) => (
                  <th
                    key={dateStr}
                    className={`px-2 py-3 text-center font-medium ${
                      i >= 5
                        ? "text-gray-400 dark:text-gray-500"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {tDays(DAY_KEYS[i])}
                  </th>
                ))}
                <th className="px-3 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                  {t("colTotal")}
                </th>
                <th className="px-3 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                  {t("colStatus")}
                </th>
                <th className="px-3 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                  {t("colAction")}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                  >
                    {onlyMissing ? t("allSubmittedWeek") : t("noEmployees")}
                  </td>
                </tr>
              )}
              {members.map((m) => {
                const canSelect = selectable.some((s) => s.userId === m.userId);
                const expanded = expandedUserId === m.userId;
                const bal = balanceByUser.get(m.userId);
                return (
                  <Fragment key={m.userId}>
                    <tr
                      className={`border-b border-gray-100 dark:border-gray-700/50 ${expanded ? "bg-gray-50/60 dark:bg-gray-800/40" : ""}`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={t("selectName", { name: m.name })}
                          disabled={!canSelect}
                          checked={selected.has(m.userId)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(m.userId);
                              else next.delete(m.userId);
                              return next;
                            })
                          }
                          className="h-4 w-4 rounded border-gray-300 disabled:opacity-30"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {m.name}
                        </div>
                        <CompletenessBadge completeness={m.completeness} />
                        {balances && bal && (
                          <BalanceChips
                            {...bal}
                            asOf={balances.asOf}
                            periodLabel={balances.periodLabel}
                          />
                        )}
                      </td>
                      {days.map((dateStr) => {
                        const absence = m.absenceByDay[dateStr];
                        const hours = m.perDay[dateStr];
                        return (
                          <td
                            key={dateStr}
                            className="px-2 py-2 text-center tabular-nums"
                          >
                            {absence ? (
                              <span
                                title={absence.name}
                                className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                                style={{ backgroundColor: absence.color }}
                              >
                                {absence.name.slice(0, 4).toUpperCase()}
                              </span>
                            ) : hours ? (
                              formatTotal(hours)
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">
                                –
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatTotal(m.total)}
                        <span className="ml-1 text-xs font-normal text-gray-400">
                          / {formatTotal(m.norm)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <FlowBadge status={m.weekStatus} />
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedUserId(expanded ? null : m.userId)
                            }
                            className={`rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ${expanded ? "text-gray-700 dark:text-gray-200" : ""}`}
                            title={t("showEvents")}
                            aria-expanded={expanded}
                            aria-label={t("eventsFor", { name: m.name })}
                          >
                            <History className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {m.rejectionReason && (
                          <p
                            className="mt-0.5 max-w-[160px] truncate text-[11px] text-red-600 dark:text-red-400"
                            title={m.rejectionReason}
                          >
                            {m.rejectionReason}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {m.weekStatus === "approved" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setReopening(m.userId);
                              setReopenReason("");
                            }}
                            disabled={reopen.isPending}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                            title={t("reopenTitle")}
                          >
                            <RotateCcw className="h-3 w-3" /> {t("reopen")}
                          </button>
                        ) : m.total > 0 ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                approve.mutate({
                                  userId: m.userId,
                                  weekStart: weekStartStr,
                                })
                              }
                              disabled={approve.isPending}
                              className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              <Check className="h-3 w-3" /> {t("approve")}
                            </button>
                            {m.weekStatus === "submitted" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRejecting(m.userId);
                                  setRejectReason("");
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                              >
                                <X className="h-3 w-3" /> {t("reject")}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-gray-100 bg-gray-50/60 dark:border-gray-700/50 dark:bg-gray-800/40">
                        <td colSpan={12} className="p-0">
                          <WeekEventsTimeline
                            userId={m.userId}
                            weekStart={weekStartStr}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Afvisnings-dialog */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("rejectDialogTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("rejectDialogInfo")}
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={3}
              className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejecting(null)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  reject.mutate({
                    userId: rejecting,
                    weekStart: weekStartStr,
                    reason: rejectReason.trim(),
                  })
                }
                disabled={reject.isPending || rejectReason.trim().length === 0}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t("rejectWeek")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Genåbnings-dialog — årsagen er obligatorisk og logges */}
      {reopening && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("reopenDialogTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("reopenDialogInfo")}
            </p>
            <label htmlFor="reopen-reason" className="sr-only">
              {t("reason")}
            </label>
            <textarea
              id="reopen-reason"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder={t("reopenReasonPlaceholder")}
              rows={3}
              maxLength={500}
              className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReopening(null)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  reopen.mutate({
                    userId: reopening,
                    weekStart: weekStartStr,
                    reason: reopenReason.trim(),
                  })
                }
                disabled={reopen.isPending || reopenReason.trim().length < 3}
                className="rounded-lg bg-tt-gran px-3 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {t("reopenWeek")}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("footnote")}
      </p>
    </div>
  );
}

export default function TeamPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="manager" excludeRoles={["hr"]}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16">
              <InlineSpinner />
            </div>
          }
        >
          <TeamPageContent />
        </Suspense>
      </RoleGuard>
    </ModuleGuard>
  );
}
