// src/app/dashboard/reports/_components/ScheduleReportDialog.tsx
"use client";
import { CalendarClock, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

interface Props {
  open: boolean;
  templateId: string | null;
  templateName?: string;
  onClose: () => void;
}

const WEEKDAYS = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 7, key: "sun" },
] as const;

export function ScheduleReportDialog({
  open,
  templateId,
  templateName,
  onClose,
}: Props) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("monthly");
  const [sendDay, setSendDay] = useState(1);
  const [recipients, setRecipients] = useState("");
  const [format, setFormat] = useState<"pdf" | "xlsx" | "csv">("pdf");

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const utils = trpc.useUtils();
  const { data: schedules } = trpc.reports.listSchedules.useQuery(undefined, {
    enabled: open,
  });

  const create = trpc.reports.createSchedule.useMutation({
    onSuccess: () => {
      utils.reports.listSchedules.invalidate();
      toast.success(t("schedule.created"));
      setRecipients("");
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = trpc.reports.toggleSchedule.useMutation({
    onSuccess: () => utils.reports.listSchedules.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.reports.deleteSchedule.useMutation({
    onSuccess: () => {
      utils.reports.listSchedules.invalidate();
      toast.success(t("schedule.deleted"));
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  const parsedRecipients = recipients
    .split(/[,;\s]+/)
    .map((r) => r.trim())
    .filter(Boolean);

  const handleCreate = () => {
    if (!templateId) return;
    create.mutate({
      reportTemplateId: templateId,
      frequency,
      sendDay,
      recipients: parsedRecipients,
      format,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label={tc("close")}
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <CalendarClock className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          {t("schedule.title")}
        </h2>

        {templateId ? (
          <>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t.rich("schedule.intro", {
                name: templateName ?? "",
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>

            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="schedule-frequency"
                    className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                  >
                    {t("schedule.frequency")}
                  </label>
                  <select
                    id="schedule-frequency"
                    value={frequency}
                    onChange={(e) => {
                      setFrequency(e.target.value as "weekly" | "monthly");
                      setSendDay(1);
                    }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    <option value="monthly">{t("schedule.monthly")}</option>
                    <option value="weekly">{t("schedule.weekly")}</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="schedule-day"
                    className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                  >
                    {frequency === "weekly"
                      ? t("schedule.weekday")
                      : t("schedule.dayOfMonth")}
                  </label>
                  {frequency === "weekly" ? (
                    <select
                      id="schedule-day"
                      value={sendDay}
                      onChange={(e) => setSendDay(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {t(`schedule.${d.key}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="schedule-day"
                      type="number"
                      min={1}
                      max={28}
                      value={sendDay}
                      onChange={(e) =>
                        setSendDay(
                          Math.min(28, Math.max(1, Number(e.target.value))),
                        )
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="schedule-recipients"
                  className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                >
                  {t("schedule.recipients")}
                </label>
                <input
                  id="schedule-recipients"
                  type="text"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder={t("schedule.recipientsPlaceholder")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="schedule-format"
                  className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                >
                  {t("schedule.format")}
                </label>
                <select
                  id="schedule-format"
                  value={format}
                  onChange={(e) =>
                    setFormat(e.target.value as "pdf" | "xlsx" | "csv")
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="pdf">{t("schedule.formatPdf")}</option>
                  <option value="xlsx">{t("schedule.formatExcel")}</option>
                  <option value="csv">CSV</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={parsedRecipients.length === 0 || create.isPending}
                className="w-full rounded-lg bg-tt-gran px-4 py-2 text-sm font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {create.isPending
                  ? t("schedule.creating")
                  : t("schedule.schedule")}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("schedule.saveFirst")}
          </p>
        )}

        {schedules && schedules.length > 0 && (
          <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("schedule.scheduled")}
            </p>
            <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
              {schedules.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {s.templateName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {s.frequency === "weekly"
                        ? t("schedule.weeklyOn", {
                            day: (() => {
                              const wd = WEEKDAYS.find(
                                (d) => d.value === s.sendDay,
                              );
                              return wd ? t(`schedule.${wd.key}`) : s.sendDay;
                            })(),
                          })
                        : t("schedule.monthlyOn", { day: s.sendDay })}
                      {" · "}
                      {s.format.toUpperCase()}
                      {" · "}
                      {t("schedule.recipientCount", {
                        count: (s.recipients as string[]).length,
                      })}
                    </p>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={s.isActive}
                      onChange={(e) =>
                        toggle.mutate({ id: s.id, isActive: e.target.checked })
                      }
                    />
                    {t("schedule.active")}
                  </label>
                  <button
                    type="button"
                    title={t("schedule.deleteSchedule")}
                    onClick={() => remove.mutate({ id: s.id })}
                    disabled={remove.isPending}
                    className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {tc("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
