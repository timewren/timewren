import { Ticket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { KlippekortHuller } from "@/components/klippekort/KlippekortHuller";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { formatTime } from "@/lib/format";
import { prepaidBalanceLevel } from "@/lib/prepaid/balance";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function LowBalancePackagesWidget() {
  const t = useTranslations("dashboard.widgets.lowBalance");
  const {
    data: lowBalancePackages,
    isLoading,
    isError,
  } = trpc.prepaid.getLowBalance.useQuery({});

  // Et advarselswidget må ikke sige "alt er fint" mens det henter eller fejler
  if (isLoading || isError) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={
          <Ticket className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        }
      >
        <div className="flex items-center justify-center h-full">
          {isError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {t("loadFailed")}
            </p>
          ) : (
            <InlineSpinner className="h-6 w-6" />
          )}
        </div>
      </DashboardWidget>
    );
  }

  if (!lowBalancePackages || lowBalancePackages.length === 0) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={
          <Ticket className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        }
      >
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {t("none")}
          </p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget
      title={t("title")}
      variant="warning"
      icon={<Ticket className="h-5 w-5 text-orange-600 dark:text-orange-400" />}
      actions={
        <Link
          href="/dashboard/klippekort"
          className="text-sm font-medium text-orange-600 dark:text-orange-400 hover:underline"
        >
          {t("seeAll")}
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">{t("intro")}</p>
        <div className="space-y-2">
          {lowBalancePackages.slice(0, 3).map((pkg) => {
            const remaining = parseFloat(pkg.remainingHours || "0");
            const total = parseFloat(pkg.totalHours || "0");
            const tone =
              prepaidBalanceLevel(remaining, total) === "critical"
                ? "tom"
                : "lav";

            return (
              <Link
                key={pkg.id}
                href={`/dashboard/klippekort/${pkg.id}`}
                className="block rounded-lg border border-orange-200 dark:border-orange-800 bg-white dark:bg-gray-900 p-3 transition-colors hover:border-orange-300 dark:hover:border-orange-700"
              >
                <p className="font-medium text-gray-900 dark:text-white">
                  {pkg.name}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {(Array.isArray(pkg.client) ? pkg.client[0] : pkg.client)
                    ?.name ?? t("noClient")}
                </p>
                <KlippekortHuller
                  className="mt-2"
                  size="sm"
                  totalHours={total}
                  remainingHours={remaining}
                  tone={tone}
                />
                <p className="mt-1 text-xs tabular-nums text-orange-700 dark:text-orange-400">
                  {t("left", { time: formatTime(pkg.remainingHours) })}
                </p>
              </Link>
            );
          })}
          {lowBalancePackages.length > 3 && (
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              {t("more", { count: lowBalancePackages.length - 3 })}
            </p>
          )}
        </div>
      </div>
    </DashboardWidget>
  );
}
