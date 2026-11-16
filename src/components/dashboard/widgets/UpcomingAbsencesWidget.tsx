import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

function formatDateRange(
  start: string,
  end: string | null,
  locale: string,
  fromLabel: (date: string) => string,
): string {
  const startDate = new Date(start);
  const fmt = (d: Date) =>
    d.toLocaleDateString(toIntlLocale(locale), {
      day: "numeric",
      month: "short",
    });
  // Åben periode (sygdom uden slutdato, #460)
  if (!end) return fromLabel(fmt(startDate));
  const endDate = new Date(end);
  const sameDay = start === end;
  return sameDay ? fmt(startDate) : `${fmt(startDate)}–${fmt(endDate)}`;
}

export function UpcomingAbsencesWidget() {
  const t = useTranslations("dashboard.widgets.absences");
  const locale = useLocale();
  const { data, isLoading } = trpc.enterprise.listRequests.useQuery({
    status: "approved",
  });

  const now = new Date();
  const upcoming = (data ?? [])
    .filter((r: { startDate: string }) => new Date(r.startDate) >= now)
    .sort(
      (a: { startDate: string }, b: { startDate: string }) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    )
    .slice(0, 5);

  return (
    <div className="h-full rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="h-5 w-5 text-tt-graa" />
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {t("title")}
        </span>
      </div>
      {isLoading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t("loading")}
        </div>
      ) : upcoming.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 text-center">
          {t("none")}
        </div>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto text-sm">
          {upcoming.map(
            (r: {
              id: string;
              startDate: string;
              endDate: string | null;
              userName?: string | null;
              typeName?: string | null;
            }) => (
              <li
                key={r.id}
                className="flex flex-col border-b border-gray-200 dark:border-gray-700 pb-1.5 last:border-none last:pb-0"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {r.userName ?? t("employee")}
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{r.typeName ?? t("absence")}</span>
                  <span>
                    {formatDateRange(r.startDate, r.endDate, locale, (date) =>
                      t("from", { date }),
                    )}
                  </span>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
