"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Pencil,
  Undo2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { downloadCsv } from "@/lib/enterprise/csv";
import type {
  DeviationKind,
  RegisteredDay,
  RegisteredStatus,
} from "@/lib/enterprise/work-plan";
import {
  addDaysToDateStr,
  copenhagenToday,
  isoWeekdayOfDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

const WEEKDAY_KEYS = ["", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const STATUS_STYLE: Record<RegisteredStatus, { cls: string }> = {
  plan: {
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  deviation: {
    cls: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  day_off: {
    cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  absence: {
    cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  free: {
    cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  },
};

export function useFmtHours(): (h: number) => string {
  const t = useTranslations("enterpriseComponents.workPlan");
  const intl = toIntlLocale(useLocale());
  return (h: number) =>
    t("hoursShort", {
      value: h.toLocaleString(intl, { maximumFractionDigits: 2 }),
    });
}

export function useFmtDay(): (date: string) => string {
  const tDays = useTranslations("team.days");
  return (date: string) => {
    const [, m, d] = date.split("-");
    return `${tDays(WEEKDAY_KEYS[isoWeekdayOfDateStr(date)])} ${Number(d)}/${Number(m)}`;
  };
}

function span(start: string | null, end: string | null): string {
  return start && end ? `${start}–${end}` : "";
}

interface Props {
  /** Leder/HR ser en medarbejder; udeladt = mig selv */
  userId?: string;
  /** Må den viste bruger rettes? (leder for andre, altid for sig selv) */
  canEdit: boolean;
}

export function MyWorkDays({ userId, canEdit }: Props) {
  const t = useTranslations("enterpriseComponents.workPlan.days");
  const fmtHours = useFmtHours();
  const fmtDay = useFmtDay();
  const intl = toIntlLocale(useLocale());
  const [weekStart, setWeekStart] = useState(() =>
    weekStartDateStr(copenhagenToday()),
  );
  const weekEnd = addDaysToDateStr(weekStart, 6);
  const [editing, setEditing] = useState<RegisteredDay | null>(null);
  const [showLog, setShowLog] = useState(false);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.enterprise.workPlanDays.useQuery({
    from: weekStart,
    to: weekEnd,
    userId,
  });
  const log = trpc.enterprise.workPlanDeviationLog.useQuery(
    { userId },
    { enabled: showLog },
  );

  const invalidate = () => {
    utils.enterprise.workPlanDays.invalidate();
    utils.enterprise.workPlanDeviationLog.invalidate();
    // Flex og dækningsgrad bygger på samme dage (tRPC-cache, 5 min)
    utils.enterprise.getBalance.invalidate();
    utils.enterprise.getEntries.invalidate();
  };
  const clear = trpc.enterprise.workPlanClearDeviation.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("cleared"));
    },
    onError: (e) => toast.error(e.message),
  });
  const exportCsv = trpc.enterprise.workPlanExport.useMutation({
    onSuccess: (res) => {
      downloadCsv(res.filename, res.csv);
      toast.success(t("exported", { count: res.rows }));
    },
    onError: (e) => toast.error(e.message),
  });

  const year = weekStart.slice(0, 4);
  const today = data?.today ?? copenhagenToday();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("prevWeek")}
            onClick={() => setWeekStart(addDaysToDateStr(weekStart, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium text-gray-900 dark:text-gray-100">
            {fmtDay(weekStart)} – {fmtDay(weekEnd)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("nextWeek")}
            onClick={() => setWeekStart(addDaysToDateStr(weekStart, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWeekStart(weekStartDateStr(copenhagenToday()))}
          >
            {t("today")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLog((v) => !v)}
          >
            <History className="mr-1.5 h-4 w-4" />
            {t("changeLog")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exportCsv.isPending}
            onClick={() =>
              exportCsv.mutate({
                from: `${year}-01-01`,
                to: `${year}-12-31`,
                userId,
              })
            }
          >
            <Download className="mr-1.5 h-4 w-4" />
            {t("exportYear", { year })}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-11 rounded bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : !data?.hasPlan ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
          {t("noPlan")}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                  <th className="px-4 py-2.5 font-medium">{t("colDay")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("colStatus")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("colPlan")}</th>
                  <th className="px-4 py-2.5 font-medium">
                    {t("colRegistered")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {t("colHours")}
                  </th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">{t("colActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => {
                  const st = STATUS_STYLE[d.status];
                  const isToday = d.date === today;
                  return (
                    <tr
                      key={d.date}
                      className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={
                            isToday
                              ? "font-semibold text-gray-900 dark:text-gray-100"
                              : "text-gray-800 dark:text-gray-200"
                          }
                        >
                          {fmtDay(d.date)}
                        </span>
                        {d.dayOff && (
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                            {d.dayOff.name}
                            {d.dayOff.isHalfDay ? t("half") : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${st.cls}`}
                        >
                          {t(`status.${d.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-gray-400">
                        {d.planned
                          ? `${span(d.planned.start, d.planned.end)}${d.planned.breakMinutes ? t("breakPart", { minutes: d.planned.breakMinutes }) : ""}`
                          : "–"}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-800 dark:text-gray-200">
                        {d.deviation?.kind === "absence"
                          ? t("noWorkTime")
                          : span(d.start, d.end) || (d.hours ? "" : "–")}
                        {d.deviation?.note && (
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                            {d.deviation.note}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">
                        {fmtHours(d.hours)}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {canEdit && d.date <= today && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("editDay", { day: fmtDay(d.date) })}
                            onClick={() => setEditing(d)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canEdit && d.deviation && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("followPlan", {
                              day: fmtDay(d.date),
                            })}
                            disabled={clear.isPending}
                            onClick={() =>
                              clear.mutate({ date: d.date, userId })
                            }
                          >
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("totals", {
              planned: fmtHours(data.totals.planned),
              registered: fmtHours(data.totals.registered),
            })}
            {data.totals.deviations > 0 &&
              t("deviations", { count: data.totals.deviations })}
          </p>
        </>
      )}

      {showLog && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            {t("logTitle")}
          </h3>
          {log.isLoading ? (
            <p className="text-sm text-gray-500">{t("loading")}</p>
          ) : !log.data?.length ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("noChanges")}
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {log.data.map((r) => (
                <li key={r.id} className="text-gray-700 dark:text-gray-300">
                  <span className="tabular-nums text-gray-500 dark:text-gray-400">
                    {new Date(r.createdAt).toLocaleString(intl, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>{" "}
                  · {r.actorLabel ?? t("logUnknown")} ·{" "}
                  {r.action === "work_day_deviation_set"
                    ? t("logSet", {
                        day: fmtDay(String(r.metadata?.date ?? "")),
                      })
                    : r.action === "work_day_deviation_cleared"
                      ? t("logCleared", {
                          day: fmtDay(String(r.metadata?.date ?? "")),
                        })
                      : r.metadata?.planName
                        ? t("logAssignedPlan", {
                            plan: String(r.metadata.planName),
                            date: String(r.metadata?.validFrom ?? ""),
                          })
                        : t("logAssignedNone", {
                            date: String(r.metadata?.validFrom ?? ""),
                          })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <DeviationModal
          day={editing}
          userId={userId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function DeviationModal({
  day,
  userId,
  onClose,
  onSaved,
}: {
  day: RegisteredDay;
  userId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("enterpriseComponents.workPlan.dev");
  const fmtHours = useFmtHours();
  const fmtDay = useFmtDay();
  const base = day.deviation ?? null;
  const [kind, setKind] = useState<DeviationKind>(
    base?.kind === "absence" ? "absence" : "worked",
  );
  const [start, setStart] = useState(
    base?.startTime ?? day.planned?.start ?? "",
  );
  const [end, setEnd] = useState(base?.endTime ?? day.planned?.end ?? "");
  const [pause, setPause] = useState(
    String(base?.breakMinutes ?? day.planned?.breakMinutes ?? 0),
  );
  const [note, setNote] = useState(base?.note ?? "");

  const save = trpc.enterprise.workPlanSetDeviation.useMutation({
    onSuccess: () => {
      toast.success(t("saved"));
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const preview = useMemo(() => {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm) - (Number(pause) || 0);
    return Number.isFinite(mins) && mins > 0 ? mins / 60 : null;
  }, [start, end, pause]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("title", { day: fmtDay(day.date) })}
      description={
        day.planned
          ? t("planSays", {
              span: span(day.planned.start, day.planned.end),
              hours: fmtHours(day.planned.hours),
            })
          : t("noWork")
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            date: day.date,
            userId,
            kind,
            startTime: kind === "worked" ? start : null,
            endTime: kind === "worked" ? end : null,
            breakMinutes: kind === "worked" ? Number(pause) || 0 : null,
            note: note.trim() || null,
          });
        }}
      >
        <Select
          label={t("whatHappened")}
          value={kind}
          onChange={(e) => setKind(e.target.value as DeviationKind)}
          options={[
            { value: "worked", label: t("worked") },
            { value: "absence", label: t("absence") },
          ]}
        />
        {kind === "worked" && (
          <div className="grid grid-cols-3 gap-3">
            <Input
              label={t("start")}
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
            <Input
              label={t("end")}
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
            <Input
              label={t("break")}
              type="number"
              min={0}
              max={600}
              inputMode="numeric"
              value={pause}
              onChange={(e) => setPause(e.target.value)}
            />
          </div>
        )}
        {kind === "worked" && preview !== null && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("preview", { hours: fmtHours(Math.round(preview * 100) / 100) })}
          </p>
        )}
        {kind === "absence" && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("absenceHint")}
          </p>
        )}
        <Textarea
          label={t("note")}
          value={note}
          maxLength={500}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
