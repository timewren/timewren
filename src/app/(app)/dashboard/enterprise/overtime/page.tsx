"use client";

import { Hourglass, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatTotal } from "@/lib/enterprise/timesheet";
import { trpc } from "@/providers/trpc-provider";

const TYPE_KEYS: Record<string, string> = {
  earned: "overtime.typeEarned",
  used: "overtime.typeUsed",
  payout: "overtime.typePayout",
  adjustment: "overtime.typeAdjustment",
};

function BalanceBadge({ value }: { value: number }) {
  const t = useTranslations("enterprise");
  return (
    <span
      className={`font-semibold tabular-nums ${
        value > 0
          ? "text-green-600 dark:text-green-400"
          : value < 0
            ? "text-red-600 dark:text-red-400"
            : "text-gray-500 dark:text-gray-400"
      }`}
    >
      {value > 0 ? "+" : ""}
      {t("overtime.hoursShort", { value: formatTotal(value) })}
    </span>
  );
}

function OvertimePageContent() {
  const t = useTranslations("enterprise");
  const intlLocale = toIntlLocale(useLocale());
  const [posting, setPosting] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [postType, setPostType] = useState<"used" | "payout" | "adjustment">(
    "used",
  );
  const [postHours, setPostHours] = useState("");
  const [postNote, setPostNote] = useState("");

  const utils = trpc.useUtils();
  const { data: mine, isLoading } = trpc.enterprise.getMyOvertime.useQuery();
  const { data: overview, error: overviewError } =
    trpc.enterprise.getOvertimeOverview.useQuery(undefined, { retry: false });

  const addEntry = trpc.enterprise.addOvertimeEntry.useMutation({
    onSuccess: () => {
      utils.enterprise.getMyOvertime.invalidate();
      utils.enterprise.getOvertimeOverview.invalidate();
      setPosting(null);
      setPostHours("");
      setPostNote("");
      toast.success(t("overtime.posted"));
    },
    onError: (e) => toast.error(e.message || t("overtime.saveFailed")),
  });

  // Manager-overblikket fejler med FORBIDDEN for alm. medarbejdere — det er
  // forventet; så viser vi kun egen saldo.
  const isManagerView = !overviewError && (overview?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t("overtime.title")} />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <InlineSpinner />
        </div>
      ) : (
        <>
          {/* Egen saldo */}
          <div className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 dark:bg-tt-gran-lys">
              <Hourglass className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("overtime.yourBalance")}
              </p>
              <p className="text-2xl font-bold">
                <BalanceBadge value={mine?.balance ?? 0} />
              </p>
            </div>
            <p className="ml-auto max-w-xs text-xs text-gray-400 dark:text-gray-500">
              {t("overtime.balanceNote")}
            </p>
          </div>

          {/* Egen historik */}
          {(mine?.entries.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                      {t("overtime.colDate")}
                    </th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                      {t("overtime.colType")}
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-gray-500 dark:text-gray-400">
                      {t("overtime.colHours")}
                    </th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                      {t("overtime.colNote")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mine?.entries.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-gray-100 dark:border-gray-700/50"
                    >
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {new Date(e.createdAt).toLocaleDateString(intlLocale)}
                      </td>
                      <td className="px-4 py-2">
                        {TYPE_KEYS[e.type] ? t(TYPE_KEYS[e.type]) : e.type}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <BalanceBadge value={Number(e.hours)} />
                      </td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                        {e.note ?? "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Leder-overblik */}
          {isManagerView && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("overtime.yourTeam")}
              </h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                      <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t("overtime.colEmployee")}
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium text-gray-500 dark:text-gray-400">
                        {t("overtime.colBalance")}
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium text-gray-500 dark:text-gray-400">
                        {t("overtime.colAction")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview?.map((m) => (
                      <tr
                        key={m.userId}
                        className="border-b border-gray-100 dark:border-gray-700/50"
                      >
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {m.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {m.email}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <BalanceBadge value={m.balance} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setPosting({ userId: m.userId, name: m.name })
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                          >
                            <Plus className="h-3 w-3" /> {t("overtime.post")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Posterings-dialog */}
      {posting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("overtime.postFor", { name: posting.name })}
            </h3>
            <div className="mt-3 space-y-3">
              <select
                value={postType}
                onChange={(e) => setPostType(e.target.value as typeof postType)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              >
                <option value="used">{t("overtime.optUsed")}</option>
                <option value="payout">{t("overtime.optPayout")}</option>
                <option value="adjustment">
                  {t("overtime.optAdjustment")}
                </option>
              </select>
              <input
                type="text"
                inputMode="decimal"
                value={postHours}
                onChange={(e) => setPostHours(e.target.value)}
                placeholder={t("overtime.hoursPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
              <input
                type="text"
                value={postNote}
                onChange={(e) => setPostNote(e.target.value)}
                placeholder={t("overtime.notePlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPosting(null)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                {t("overtime.cancel")}
              </button>
              <button
                type="button"
                disabled={
                  addEntry.isPending ||
                  !postNote.trim() ||
                  Number.isNaN(Number(postHours.replace(",", ".")))
                }
                onClick={() =>
                  addEntry.mutate({
                    userId: posting.userId,
                    type: postType,
                    hours: Number(postHours.replace(",", ".")),
                    note: postNote.trim(),
                  })
                }
                className="rounded-lg bg-tt-gran px-3 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {t("overtime.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OvertimePage() {
  return (
    <ModuleGuard module="enterprise">
      <OvertimePageContent />
    </ModuleGuard>
  );
}
