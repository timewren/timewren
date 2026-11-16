"use client";

import { ChevronDown, ChevronRight, Eraser, Plus, Repeat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import {
  formatHours,
  memberWeekTotals,
  type ResourcePlanGridRow,
} from "@/lib/resource-plan/export";
import {
  type BookingStatus,
  bookingStatus,
  type DeviationStatus,
  deviationStatus,
  isoWeekNumber,
  parseHoursInput,
  rowKey,
  sumValues,
  toWeekStart,
} from "@/lib/resource-plan/plan";
import type { RouterOutputs } from "@/lib/trpc/routers";

export type ResourcePlanData = RouterOutputs["resourcePlan"]["grid"];

export interface CellChange {
  userId: string;
  projectId: string;
  activityTypeId: string | null;
  weekStart: string;
  hours: number;
}

const BOOKING_STYLES: Record<BookingStatus, string> = {
  over: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  under: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  ok: "text-green-700 dark:text-green-400",
  none: "text-gray-400 dark:text-gray-500",
};

const DEVIATION_STYLES: Record<DeviationStatus, string> = {
  over: "font-medium text-red-600 dark:text-red-400",
  under: "font-medium text-amber-700 dark:text-amber-400",
  ok: "text-gray-500 dark:text-gray-400",
  future: "text-gray-400 dark:text-gray-500",
};

/** "05.10" — mandagens dato under ugenummeret. */
function shortDate(dateStr: string): string {
  return `${dateStr.slice(8, 10)}.${dateStr.slice(5, 7)}`;
}

function PlanInput({
  value,
  label,
  resetKey,
  onCommit,
}: {
  value: number;
  label: string;
  /** Skifter når en gemning fejler, så kladden falder tilbage til serverens værdi */
  resetKey: number;
  onCommit: (hours: number) => void;
}) {
  const t = useTranslations("resourcePlan");
  const shown = value > 0 ? formatHours(value) : "";
  const [draft, setDraft] = useState(shown);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey nulstiller bevidst kladden
  useEffect(() => setDraft(shown), [shown, resetKey]);

  const commit = () => {
    const parsed = parseHoursInput(draft);
    if (parsed === null) {
      toast.error(t("grid.hoursTip"));
      setDraft(shown);
      return;
    }
    if (parsed === value) {
      setDraft(shown); // fx "7,50" over 7,5 — vis den normaliserede værdi
      return;
    }
    onCommit(parsed);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      setDraft(shown);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.currentTarget.select()}
      aria-label={label}
      placeholder="–"
      className="h-8 w-full min-w-[3.5rem] rounded-md border border-gray-200 bg-white px-2 text-right text-sm tabular-nums text-gray-900 placeholder:text-gray-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-600"
    />
  );
}

function RegisteredLine({
  planned,
  registered,
  weekStart,
  today,
}: {
  planned: number;
  registered: number;
  weekStart: string;
  today: string;
}) {
  const t = useTranslations("resourcePlan");
  const status = deviationStatus({ planned, registered, weekStart, today });
  if (status === "future" && registered === 0) return null;
  const marker = status === "over" ? " ▲" : status === "under" ? " ▼" : "";
  const title =
    status === "over"
      ? t("grid.moreRegistered")
      : status === "under"
        ? t("grid.lessRegistered")
        : undefined;
  return (
    <div
      className={`mt-0.5 text-right text-[11px] tabular-nums ${DEVIATION_STYLES[status]}`}
      title={title}
    >
      {t("grid.registeredShort", { hours: formatHours(registered) })}
      {marker}
    </div>
  );
}

interface PendingRow {
  userId: string;
  projectId: string;
  activityTypeId: string | null;
}

function AddRowForm({
  userId,
  options,
  existing,
  onAdd,
}: {
  userId: string;
  options: NonNullable<ResourcePlanData["options"]>;
  existing: Set<string>;
  onAdd: (row: PendingRow) => void;
}) {
  const t = useTranslations("resourcePlan");
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [activityTypeId, setActivityTypeId] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-tt-gran-lys"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("grid.addProject")}
      </button>
    );
  }

  const key = rowKey(userId, projectId, activityTypeId || null);
  const duplicate = projectId !== "" && existing.has(key);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!projectId || duplicate) return;
        onAdd({ userId, projectId, activityTypeId: activityTypeId || null });
        setProjectId("");
        setActivityTypeId("");
        setOpen(false);
      }}
    >
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        aria-label={t("grid.project")}
        className="h-8 rounded-md border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      >
        <option value="">{t("grid.chooseProject")}</option>
        {options.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.clientName ? `${p.name} · ${p.clientName}` : p.name}
          </option>
        ))}
      </select>
      {options.activityTypes.length > 0 && (
        <select
          value={activityTypeId}
          onChange={(e) => setActivityTypeId(e.target.value)}
          aria-label={t("grid.activity")}
          className="h-8 rounded-md border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="">{t("grid.wholeProject")}</option>
          {options.activityTypes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="submit"
        disabled={!projectId || duplicate}
        className="h-8 rounded-md bg-tt-gran px-3 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
      >
        {t("grid.add")}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-8 rounded-md px-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {t("grid.cancel")}
      </button>
      {duplicate && (
        <span className="text-xs text-amber-700 dark:text-amber-400">
          {t("grid.rowExists")}
        </span>
      )}
    </form>
  );
}

/**
 * Grid'et: medarbejdere × uger med projekt-rækker. Lederen skriver timer i
 * cellerne (gemmes ved blur/Enter); under hver celle står den registrerede
 * tid med afvigelsen markeret. Medarbejder-rækken viser planlagt mod
 * kapacitet (normtid − fridage − fravær) med over-/underbooking.
 */
export function ResourcePlanGrid({
  data,
  resetKey,
  onChange,
}: {
  data: ResourcePlanData;
  resetKey: number;
  onChange: (cells: CellChange[]) => void;
}) {
  const t = useTranslations("resourcePlan");
  const locale = useLocale();
  const weekLabel = (w: string) => t("weekShort", { week: isoWeekNumber(w) });
  const { weeks, today, canPlan, options } = data;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingRow[]>([]);

  const projectNames = useMemo(
    () => new Map((options?.projects ?? []).map((p) => [p.id, p])),
    [options],
  );
  const activityNames = useMemo(
    () => new Map((options?.activityTypes ?? []).map((a) => [a.id, a.name])),
    [options],
  );

  const rowsByMember = useMemo(() => {
    const map = new Map<string, ResourcePlanGridRow[]>();
    const keys = new Set(data.rows.map((r) => r.key));
    const all: ResourcePlanGridRow[] = [...data.rows];
    for (const p of pending) {
      const key = rowKey(p.userId, p.projectId, p.activityTypeId);
      if (keys.has(key)) continue;
      keys.add(key);
      const project = projectNames.get(p.projectId);
      all.push({
        key,
        userId: p.userId,
        projectId: p.projectId,
        activityTypeId: p.activityTypeId,
        unplanned: false,
        planned: {},
        registered: {},
        projectName: project?.name ?? t("grid.projectFallback"),
        clientName: project?.clientName ?? null,
        activityName: p.activityTypeId
          ? (activityNames.get(p.activityTypeId) ?? null)
          : null,
      });
    }
    for (const r of all) {
      const list = map.get(r.userId) ?? [];
      list.push(r);
      map.set(r.userId, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          a.projectName.localeCompare(b.projectName, locale) ||
          (a.activityName ?? "").localeCompare(b.activityName ?? "", locale),
      );
    }
    return map;
  }, [data.rows, pending, projectNames, activityNames, t, locale]);

  const toggle = (userId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const cellsFor = (
    row: ResourcePlanGridRow,
    hoursFor: (w: string) => number,
  ) =>
    weeks.map((w) => ({
      userId: row.userId,
      projectId: row.projectId,
      activityTypeId: row.activityTypeId,
      weekStart: w,
      hours: hoursFor(w),
    }));

  const fillRow = (row: ResourcePlanGridRow) => {
    const first = weeks.map((w) => row.planned[w] ?? 0).find((h) => h > 0);
    if (!first) {
      toast.info(t("grid.fillFirst"));
      return;
    }
    // Kun tomme uger — eksisterende planer overskrives ikke
    const cells = cellsFor(row, () => first).filter(
      (c) => !((row.planned[c.weekStart] ?? 0) > 0),
    );
    if (cells.length === 0) {
      toast.info(t("grid.allPlanned"));
      return;
    }
    onChange(cells);
  };
  const clearRow = (row: ResourcePlanGridRow) => {
    if (weeks.every((w) => !(row.planned[w] > 0))) {
      setPending((prev) =>
        prev.filter(
          (p) => rowKey(p.userId, p.projectId, p.activityTypeId) !== row.key,
        ),
      );
      return;
    }
    onChange(
      cellsFor(row, () => 0).filter((c) => (row.planned[c.weekStart] ?? 0) > 0),
    );
  };

  const colCount = weeks.length + 2;
  const currentWeek = toWeekStart(today);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 min-w-[14rem] bg-gray-50 px-3 py-2 text-left font-medium dark:bg-gray-900"
            >
              {t("grid.employeeProject")}
            </th>
            {weeks.map((w) => (
              <th
                key={w}
                scope="col"
                className={`min-w-[5.5rem] px-2 py-2 text-right font-medium ${w === currentWeek ? "bg-brand-50 dark:bg-tt-gran-lys" : ""}`}
                aria-current={w === currentWeek ? "date" : undefined}
              >
                <div className="text-gray-700 dark:text-gray-200">
                  {weekLabel(w)}
                </div>
                <div className="font-normal tabular-nums">{shortDate(w)}</div>
              </th>
            ))}
            <th
              scope="col"
              className="min-w-[6rem] px-3 py-2 text-right font-medium"
            >
              {t("grid.total")}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-950">
          {data.members.map((m) => {
            const rows = rowsByMember.get(m.userId) ?? [];
            const totals = memberWeekTotals(rows, m.userId, weeks);
            const isOpen = !collapsed.has(m.userId);
            const capTotal = weeks.reduce(
              (s, w) => s + (m.capacity[w]?.capacity ?? 0),
              0,
            );
            const existing = new Set(rows.map((r) => r.key));
            return (
              <Fragment key={m.userId}>
                <tr className="border-t border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/40">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left dark:bg-gray-900"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(m.userId)}
                      aria-expanded={isOpen}
                      className="inline-flex min-h-[32px] items-center gap-1.5 font-semibold text-gray-900 dark:text-white"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                      {m.name}
                    </button>
                  </th>
                  {weeks.map((w) => {
                    const cap = m.capacity[w];
                    const planned = totals.planned[w];
                    const status = bookingStatus(planned, cap?.capacity ?? 0);
                    const detail = cap
                      ? t(
                          cap.absenceHours > 0
                            ? "grid.capacityDetailAbsence"
                            : "grid.capacityDetail",
                          {
                            norm: formatHours(cap.normHours),
                            absence: formatHours(cap.absenceHours),
                            capacity: formatHours(cap.capacity),
                            planned: formatHours(planned),
                            status: t(`grid.booking.${status}`),
                          },
                        )
                      : undefined;
                    return (
                      <td
                        key={w}
                        className="px-2 py-1.5 text-right"
                        title={detail}
                      >
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs tabular-nums ${BOOKING_STYLES[status]}`}
                        >
                          {formatHours(planned)} /{" "}
                          {formatHours(cap?.capacity ?? 0)}
                          {status === "over" && " ▲"}
                          {status === "under" && " ▼"}
                          <span className="sr-only">
                            {" "}
                            {t(`grid.booking.${status}`)}
                          </span>
                        </span>
                        {cap && cap.absenceHours > 0 && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">
                            {t("grid.absence", {
                              hours: formatHours(cap.absenceHours),
                            })}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-gray-700 dark:text-gray-300">
                    {formatHours(sumValues(totals.planned))} /{" "}
                    {formatHours(capTotal)}
                  </td>
                </tr>
                {isOpen &&
                  rows.map((r) => (
                    <tr
                      key={r.key}
                      className="border-t border-gray-100 dark:border-gray-800/70"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-white py-1.5 pl-9 pr-3 text-left font-normal dark:bg-gray-950"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-gray-900 dark:text-gray-100">
                              {r.projectName}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              {r.clientName && <span>{r.clientName}</span>}
                              {r.activityName && (
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
                                  {r.activityName}
                                </span>
                              )}
                              {r.unplanned && (
                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                  {t("grid.unplanned")}
                                </span>
                              )}
                            </div>
                          </div>
                          {canPlan && (
                            <div className="flex shrink-0 gap-0.5">
                              <button
                                type="button"
                                onClick={() => fillRow(r)}
                                title={t("grid.fillTitle")}
                                aria-label={t("grid.fillLabel", {
                                  project: r.projectName,
                                })}
                                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                              >
                                <Repeat className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => clearRow(r)}
                                title={t("grid.clearTitle")}
                                aria-label={t("grid.clearLabel", {
                                  project: r.projectName,
                                })}
                                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
                              >
                                <Eraser className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </th>
                      {weeks.map((w) => {
                        const planned = r.planned[w] ?? 0;
                        const registered = r.registered[w] ?? 0;
                        return (
                          <td key={w} className="px-2 py-1.5 align-top">
                            {canPlan ? (
                              <PlanInput
                                value={planned}
                                resetKey={resetKey}
                                label={
                                  r.activityName
                                    ? t("grid.cellLabelActivity", {
                                        member: m.name,
                                        project: r.projectName,
                                        activity: r.activityName,
                                        week: weekLabel(w),
                                      })
                                    : t("grid.cellLabel", {
                                        member: m.name,
                                        project: r.projectName,
                                        week: weekLabel(w),
                                      })
                                }
                                onCommit={(hours) =>
                                  onChange([
                                    {
                                      userId: r.userId,
                                      projectId: r.projectId,
                                      activityTypeId: r.activityTypeId,
                                      weekStart: w,
                                      hours,
                                    },
                                  ])
                                }
                              />
                            ) : (
                              <div className="h-8 text-right text-sm leading-8 tabular-nums text-gray-900 dark:text-gray-100">
                                {planned > 0 ? formatHours(planned) : "–"}
                              </div>
                            )}
                            <RegisteredLine
                              planned={planned}
                              registered={registered}
                              weekStart={w}
                              today={today}
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right align-top text-xs tabular-nums">
                        <div className="text-gray-900 dark:text-gray-100">
                          {formatHours(sumValues(r.planned))}
                        </div>
                        <div className="text-gray-500 dark:text-gray-400">
                          {t("grid.registeredShort", {
                            hours: formatHours(sumValues(r.registered)),
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                {isOpen && rows.length === 0 && (
                  <tr className="border-t border-gray-100 dark:border-gray-800/70">
                    <td
                      colSpan={colCount}
                      className="py-2 pl-9 pr-3 text-xs text-gray-500 dark:text-gray-400"
                    >
                      {t("grid.nothingPlanned")}
                    </td>
                  </tr>
                )}
                {isOpen && canPlan && options && (
                  <tr className="border-t border-gray-100 dark:border-gray-800/70">
                    <td colSpan={colCount} className="py-1.5 pl-8 pr-3">
                      <AddRowForm
                        userId={m.userId}
                        options={options}
                        existing={existing}
                        onAdd={(row) => setPending((prev) => [...prev, row])}
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
  );
}
