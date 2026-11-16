"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";
const labelClass =
  "mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400";

/**
 * Manuel justering af en medarbejders feriesaldo (admin/owner, #461).
 * Posteres som signeret 'adjustment' i ferie-ledgeren med note og logges.
 */
export function VacationAdjustForm({
  userId,
  onDone,
}: {
  userId: string;
  onDone?: () => void;
}) {
  const t = useTranslations("enterpriseComponents.vacationAdjust");
  const utils = trpc.useUtils();
  const [pool, setPool] = useState<"vacation" | "extra">("vacation");
  const [days, setDays] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    toLocalDateStr(new Date()),
  );
  const [note, setNote] = useState("");

  const mutation = trpc.enterprise.adjustVacationBalance.useMutation({
    onSuccess: () => {
      utils.enterprise.getVacationBalance.invalidate();
      utils.enterprise.listVacationLedger.invalidate();
      utils.enterprise.getProfileHistory.invalidate();
      toast.success(t("saved"));
      setDays("");
      setNote("");
      onDone?.();
    },
    onError: (error) => toast.error(error.message || t("failed")),
  });

  const submit = () => {
    const parsed = Number(days.trim().replace(",", "."));
    if (Number.isNaN(parsed) || Math.round(parsed * 100) === 0) {
      toast.error(t("daysInvalid"));
      return;
    }
    if (note.trim().length < 3) {
      toast.error(t("noteShort"));
      return;
    }
    mutation.mutate({
      userId,
      pool,
      days: parsed,
      effectiveDate,
      note: note.trim(),
    });
  };

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <h4 className="mb-1 font-medium text-gray-900 dark:text-gray-100">
        {t("title")}
      </h4>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t("info")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="vacation-adjust-pool">
            {t("pool")}
          </label>
          <select
            id="vacation-adjust-pool"
            value={pool}
            onChange={(e) => setPool(e.target.value as "vacation" | "extra")}
            className={inputClass}
          >
            <option value="vacation">{t("poolVacation")}</option>
            <option value="extra">{t("poolExtra")}</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="vacation-adjust-days">
            {t("days")}
          </label>
          <input
            id="vacation-adjust-days"
            type="text"
            inputMode="decimal"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder={t("daysPlaceholder")}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="vacation-adjust-date">
            {t("effective")}
          </label>
          <input
            id="vacation-adjust-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className={labelClass} htmlFor="vacation-adjust-note">
          {t("reason")}
        </label>
        <input
          id="vacation-adjust-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("reasonPlaceholder")}
          className={inputClass}
        />
      </div>
      <div className="mt-4">
        <Button onClick={submit} disabled={mutation.isPending} size="sm">
          {mutation.isPending ? t("saving") : t("post")}
        </Button>
      </div>
    </div>
  );
}
