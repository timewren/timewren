import { BellRing } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { trpc } from "@/providers/trpc-provider";

export function PendingApprovalsWidget() {
  const t = useTranslations("dashboard.widgets.pendingApprovals");
  const { data, isLoading } = trpc.enterprise.listRequests.useQuery({
    status: "pending",
  });

  const count = data?.length ?? 0;

  return (
    <Link
      href="/dashboard/enterprise/absence"
      className="h-full rounded-xl border border-gray-200/80 dark:border-gray-800 border-l-4 border-l-amber-500 dark:border-l-amber-400 bg-white dark:bg-gray-900 p-4 flex flex-col justify-center transition hover:bg-gray-50 dark:hover:bg-gray-800/50"
    >
      <div className="flex items-center gap-2 mb-3">
        <BellRing className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {t("title")}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <p
          className={`text-2xl sm:text-3xl font-bold ${
            isLoading
              ? "text-gray-300 dark:text-gray-600"
              : count > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-gray-900 dark:text-white"
          }`}
        >
          {isLoading ? "–" : count}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {count === 1 ? t("requestOne") : t("requestOther")}
        </p>
      </div>
    </Link>
  );
}
