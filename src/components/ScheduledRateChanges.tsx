"use client";

import { CalendarClock, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toIntlLocale } from "@/i18n/format-locale";
import { parseLocalDateStr, toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

interface ScheduledRateChangesProps {
  clientId?: string;
  projectId?: string;
  /** Nuværende timepris — vises som udgangspunkt i formularen */
  currentRate?: string | null;
}

const card =
  "rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900";

function money(value: string | number, locale: string): string {
  return Number(value).toLocaleString(toIntlLocale(locale), {
    maximumFractionDigits: 2,
  });
}

export function formatEffectiveDate(dateStr: string, locale = "da"): string {
  return parseLocalDateStr(dateStr).toLocaleDateString(toIntlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Planlæg en ny timepris for en klient eller et projekt fra en dato. Tid
 * registreret på datoen eller senere får den nye pris — også når den
 * registreres bagud — mens tid før datoen beholder den gamle.
 */
export function ScheduledRateChanges({
  clientId,
  projectId,
  currentRate,
}: ScheduledRateChangesProps) {
  const t = useTranslations("settingsRates.schedule");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [newRate, setNewRate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  const target = projectId ? { projectId } : { clientId };
  const { data: planned } = trpc.scheduledRates.list.useQuery(target, {
    enabled: !!(clientId || projectId),
  });

  const invalidate = () => {
    utils.scheduledRates.list.invalidate();
    utils.rateHistory.getHistory.invalidate();
    utils.time.list.invalidate();
  };

  const createMutation = trpc.scheduledRates.create.useMutation({
    onSuccess: (result) => {
      toast.success(
        t("toastScheduled", {
          date: formatEffectiveDate(result.change.effectiveDate, locale),
        }),
        { description: t("restamped", { count: result.restamped }) },
      );
      setNewRate("");
      setEffectiveDate("");
      invalidate();
    },
    onError: (error) => {
      toast.error(t("scheduleFailed"), {
        description: error.message,
      });
    },
  });

  const cancelMutation = trpc.scheduledRates.cancel.useMutation({
    onSuccess: (result) => {
      toast.success(t("cancelled"), {
        description:
          result.restamped > 0
            ? t("cancelledRestamped", { count: result.restamped })
            : undefined,
      });
      invalidate();
    },
    onError: (error) => {
      toast.error(t("cancelFailed"), { description: error.message });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const rate = newRate.trim().replace(",", ".");
    if (!rate || Number.isNaN(Number(rate)) || Number(rate) < 0) {
      toast.error(t("invalidRate"));
      return;
    }
    if (!effectiveDate) {
      toast.error(t("missingDate"));
      return;
    }
    createMutation.mutate({ ...target, newRate: rate, effectiveDate });
  };

  const idPrefix = projectId ? "project" : "client";

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <CalendarClock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          {t("title")}
        </h3>
        {currentRate && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("current", { rate: money(currentRate, locale) })}
          </span>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <Input
          id={`${idPrefix}-scheduled-rate`}
          label={t("rateLabel")}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={newRate}
          onChange={(e) => setNewRate(e.target.value)}
          placeholder={currentRate ? String(Number(currentRate)) : "800"}
        />
        <Input
          id={`${idPrefix}-scheduled-date`}
          label={t("dateLabel")}
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          min="2000-01-01"
        />
        <Button type="submit" isLoading={createMutation.isPending}>
          {t("submit")}
        </Button>
      </form>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {t("help")}
      </p>

      {planned && planned.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {planned.map((change) => {
            const due = change.effectiveDate <= toLocalDateStr(new Date());
            return (
              <li
                key={change.id}
                className="flex items-center justify-between gap-3 py-2.5 last:pb-0"
              >
                <div className="min-w-0 text-sm">
                  <span className="tabular-nums text-gray-900 dark:text-white">
                    {t("ratePerHour", { rate: money(change.newRate, locale) })}
                  </span>{" "}
                  <span className="text-gray-500 dark:text-gray-400">
                    {t("fromDate", {
                      date: formatEffectiveDate(change.effectiveDate, locale),
                    })}
                    {due && ` · ${t("takesEffectTonight")}`}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<X />}
                  isLoading={
                    cancelMutation.isPending &&
                    cancelMutation.variables?.id === change.id
                  }
                  onClick={() => cancelMutation.mutate({ id: change.id })}
                >
                  {t("cancel")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
