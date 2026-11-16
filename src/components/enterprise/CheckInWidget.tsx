"use client";

import { LogIn, LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { useNumberFormat } from "./useNumberFormat";

function formatElapsed(from: Date, now: Date): string {
  const totalMinutes = Math.max(
    0,
    Math.floor((now.getTime() - from.getTime()) / 60_000),
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Check-ind/ud-widget til daglig fremmøderegistrering. Check-ud opretter
 * en tidsregistrering med start/slut som tæller i normtid og flex.
 */
export function CheckInWidget() {
  const t = useTranslations("enterpriseComponents.checkIn");
  const intlLocale = toIntlLocale(useLocale());
  const fmt2 = useNumberFormat(2);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.enterprise.getCheckInStatus.useQuery(
    undefined,
    { refetchInterval: 60_000 },
  );

  // Tikkende ur mens man er checket ind
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!data?.open) return;
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, [data?.open]);

  const checkIn = trpc.enterprise.checkIn.useMutation({
    onSuccess: () => {
      setNow(new Date());
      utils.enterprise.getCheckInStatus.invalidate();
      toast.success(t("checkedIn"));
    },
    onError: (e) => toast.error(e.message || t("checkInFailed")),
  });

  const checkOut = trpc.enterprise.checkOut.useMutation({
    onSuccess: (result) => {
      utils.enterprise.getCheckInStatus.invalidate();
      utils.enterprise.getTimesheetWeek.invalidate();
      utils.enterprise.getBalance.invalidate();
      if (result.hours > 0) {
        const breakNote =
          result.breakDeductedHours > 0
            ? t("breakNote", {
                minutes: Math.round(result.breakDeductedHours * 60),
              })
            : "";
        toast.success(
          t("recorded", {
            hours: fmt2(result.hours),
            breakNote,
          }),
        );
        // Arbejdstidsregler (E11, #469) — check-ud blokeres aldrig, kun advarsel
        for (const w of result.complianceWarnings ?? []) toast.warning(w);
      } else {
        toast.success(t("cancelled"));
      }
    },
    onError: (e) => toast.error(e.message || t("checkOutFailed")),
  });

  if (isLoading) {
    return (
      <div className="h-20 animate-pulse rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50" />
    );
  }

  const open = data?.open;
  const checkedInAt = open ? new Date(open.checkedInAt) : null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div>
        {open && checkedInAt ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {t("checkedInAt", {
                  time: checkedInAt.toLocaleTimeString(intlLocale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("elapsed", { elapsed: formatElapsed(checkedInAt, now) })}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {t("title")}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {(data?.todayCount ?? 0) > 0
                ? t("todayHours", {
                    hours: fmt2(data?.todayHours ?? 0),
                  })
                : t("notCheckedIn")}
            </p>
            {(data?.todayBreakDeductedHours ?? 0) > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {t("breakDeducted", {
                  minutes: Math.round(
                    (data?.todayBreakDeductedHours ?? 0) * 60,
                  ),
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {open ? (
        <button
          type="button"
          onClick={() => checkOut.mutate(undefined)}
          disabled={checkOut.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {t("checkOut")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => checkIn.mutate()}
          disabled={checkIn.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          {t("checkIn")}
        </button>
      )}
    </div>
  );
}
