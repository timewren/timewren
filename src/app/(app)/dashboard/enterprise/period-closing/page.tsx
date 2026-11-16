"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Lock,
  RefreshCw,
  Unlock,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { formatSignedHours } from "@/components/dashboard/widgets/FlexNormWidget";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  type ClosingSummary,
  isClosingLocked,
  MIN_UNLOCK_REASON,
  type PeriodClosingStatus,
} from "@/lib/enterprise/period-closing";
import { roleCanWriteTeam, roleSatisfies } from "@/lib/permissions/org-role";
import { addDaysToDateStr } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

function useH(): (value: number | null | undefined) => string {
  const intlLocale = toIntlLocale(useLocale());
  return (value) =>
    (value ?? 0).toLocaleString(intlLocale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
}

const STATUS_CLASSES: Record<PeriodClosingStatus, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  approved:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
  acknowledged:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  reopened: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

function StatusBadge({ status }: { status: string }) {
  const tc = useTranslations("enterpriseCommon");
  const s = (status in STATUS_CLASSES ? status : "open") as PeriodClosingStatus;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[s]}`}
    >
      {isClosingLocked(s) && <Lock className="h-3 w-3" aria-hidden />}
      {tc(`periodClosing.status.${s}`)}
    </span>
  );
}

function SummaryList({ summary }: { summary: ClosingSummary | null }) {
  const t = useTranslations("enterprise.periodClosing");
  const h = useH();
  const hv = (value: string) => t("hoursValue", { value });
  if (!summary) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t("notComputed")}
      </p>
    );
  }
  const items: Array<[string, string]> = [
    [t("registered"), hv(h(summary.registered))],
    [t("netNorm"), hv(h(summary.net))],
    [t("flexInPeriod"), hv(formatSignedHours(summary.flex))],
    [
      t("vacation"),
      t("daysHours", {
        count: summary.vacationDays,
        hours: h(summary.vacation),
      }),
    ],
    [
      t("otherAbsence"),
      t("daysHours", {
        count: summary.otherAbsenceDays,
        hours: h(summary.otherAbsence),
      }),
    ],
    [t("daysOff"), hv(h(summary.daysOff))],
  ];
  if (summary.flexBalance != null) {
    items.push([
      t("flexBalanceEnd"),
      hv(formatSignedHours(summary.flexBalance)),
    ]);
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-gray-600 dark:text-gray-300">{label}</dt>
          <dd className="tabular-nums text-gray-900 dark:text-gray-100">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MyClosings() {
  const t = useTranslations("enterprise.periodClosing");
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.enterprise.listMyPeriodClosings.useQuery();
  const acknowledge = trpc.enterprise.acknowledgePeriodClosing.useMutation({
    onSuccess: () => {
      utils.enterprise.listMyPeriodClosings.invalidate();
      toast.success(t("acknowledged"));
    },
    onError: (e) => toast.error(e.message || t("acknowledgeFailed")),
  });

  if (isLoading) {
    return (
      <div className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
    );
  }
  const closings = data?.closings ?? [];
  if (closings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
        {data?.interval ? t("noneYet") : t("notUsed")}
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {closings.map((c) => (
        <li
          key={c.id}
          className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-medium capitalize text-gray-900 dark:text-gray-100">
                {c.label}
              </h3>
              <StatusBadge status={c.status} />
            </div>
            {c.status === "approved" && (
              <Button
                size="sm"
                onClick={() => acknowledge.mutate({ id: c.id })}
                disabled={acknowledge.isPending}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                {t("acknowledge")}
              </Button>
            )}
          </div>
          <SummaryList summary={c.summary} />
          {c.status === "reopened" && c.unlockReason && (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              {t("unlockedReason", { reason: c.unlockReason })}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function TeamClosings({
  canApprove,
  isAdmin,
}: {
  canApprove: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations("enterprise.periodClosing");
  const tc = useTranslations("enterpriseCommon");
  const h = useH();
  const utils = trpc.useUtils();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [unlocking, setUnlocking] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const { data, isLoading } = trpc.enterprise.listTeamPeriodClosings.useQuery(
    date ? { date } : undefined,
  );
  const invalidate = () => {
    utils.enterprise.listTeamPeriodClosings.invalidate();
    utils.enterprise.listMyPeriodClosings.invalidate();
    utils.enterprise.getTimesheetWeek.invalidate();
  };
  const onError = (e: { message: string }) =>
    toast.error(e.message || t("actionFailed"));
  const generate = trpc.enterprise.generatePeriodClosings.useMutation({
    onSuccess: (r) => {
      invalidate();
      toast.success(
        r.created === 0 ? t("allExist") : t("generated", { count: r.created }),
      );
    },
    onError,
  });
  const refresh = trpc.enterprise.refreshPeriodClosing.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("recalculated"));
    },
    onError,
  });
  const approve = trpc.enterprise.approvePeriodClosing.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("approvedLocked"));
    },
    onError,
  });
  const unlock = trpc.enterprise.unlockPeriodClosing.useMutation({
    onSuccess: () => {
      invalidate();
      setUnlocking(null);
      setReason("");
      toast.success(t("unlocked"));
    },
    onError,
  });

  if (isLoading) {
    return (
      <div className="h-32 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
    );
  }
  if (!data?.interval || !data.period) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
        {t("disabled")}{" "}
        {isAdmin && (
          <Link
            href="/dashboard/enterprise/settings#period-closing-settings"
            className="font-medium text-brand-700 underline dark:text-brand-400"
          >
            {t("enableInSettings")}
          </Link>
        )}
      </div>
    );
  }
  const period = data.period;
  const missing = data.rows.filter((r) => !r.closing).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("prevPeriod")}
            onClick={() => setDate(addDaysToDateStr(period.start, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="min-w-[10rem] text-center font-medium capitalize text-gray-900 dark:text-gray-100">
            {period.label}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("nextPeriod")}
            onClick={() => setDate(addDaysToDateStr(period.end, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            {tc(`periodClosing.interval.${data.interval}`)}
          </span>
        </div>
        {canApprove && period.ended && missing > 0 && (
          <Button
            size="sm"
            onClick={() => generate.mutate({ date: period.start })}
            disabled={generate.isPending}
          >
            {t("generateN", { count: missing })}
          </Button>
        )}
      </div>
      {!period.ended && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("notEnded")}
        </p>
      )}

      {data.rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("noEmployees")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">
              {t("tableCaption", { label: period.label })}
            </caption>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t("colEmployee")}
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t("colStatus")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colRegistered")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colNorm")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colFlex")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("colAbsenceDays")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const c = r.closing;
                const s = c?.summary ?? null;
                return (
                  <tr
                    key={r.userId}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                  >
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                      {r.name}
                    </td>
                    <td className="px-3 py-2">
                      {c ? (
                        <StatusBadge status={c.status} />
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t("notCreated")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s ? h(s.registered) : "–"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s ? h(s.net) : "–"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s ? formatSignedHours(s.flex) : "–"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s ? s.vacationDays + s.otherAbsenceDays : "–"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {c &&
                          canApprove &&
                          (c.status === "open" || c.status === "reopened") && (
                            <>
                              <button
                                type="button"
                                onClick={() => refresh.mutate({ id: c.id })}
                                disabled={refresh.isPending}
                                className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                                title={t("recalcTitle")}
                              >
                                <RefreshCw className="h-3 w-3" aria-hidden />
                                <span className="sr-only sm:not-sr-only">
                                  {t("update")}
                                </span>
                              </button>
                              {!r.isSelf && (
                                <button
                                  type="button"
                                  onClick={() => approve.mutate({ id: c.id })}
                                  disabled={approve.isPending}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md bg-green-700 px-2 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-50"
                                >
                                  <CheckCircle2
                                    className="h-3 w-3"
                                    aria-hidden
                                  />
                                  {t("approveLock")}
                                </button>
                              )}
                            </>
                          )}
                        {c && isAdmin && isClosingLocked(c.status) && (
                          <button
                            type="button"
                            onClick={() => {
                              setUnlocking({ id: c.id, name: r.name });
                              setReason("");
                            }}
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                          >
                            <Unlock className="h-3 w-3" aria-hidden />
                            {t("unlock")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unlocking && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unlock-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <h3
              id="unlock-title"
              className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              {t("unlockTitle", { name: unlocking.name })}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t("unlockInfo")}
            </p>
            <label htmlFor="unlock-reason" className="sr-only">
              {t("reason")}
            </label>
            <textarea
              id="unlock-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={3}
              maxLength={500}
              className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setUnlocking(null)}>
                {t("cancel")}
              </Button>
              <Button
                onClick={() =>
                  unlock.mutate({ id: unlocking.id, reason: reason.trim() })
                }
                disabled={
                  unlock.isPending || reason.trim().length < MIN_UNLOCK_REASON
                }
              >
                {t("unlock")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PeriodClosingPageContent() {
  const t = useTranslations("enterprise.periodClosing");
  const { data: role } = trpc.rolePermissions.getMyRole.useQuery(undefined, {
    staleTime: 60_000,
  });
  const r = role?.role ?? null;
  // Leder, HR og admin ser holdet (serveren håndhæver scope)
  const canSeeTeam = roleSatisfies(r, "manager");
  const canApprove = roleCanWriteTeam(r);
  const isAdmin = r === "admin" || r === "owner";

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <section aria-labelledby="my-closings" className="space-y-3">
        <h2
          id="my-closings"
          className="text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("mine")}
        </h2>
        <MyClosings />
      </section>
      {canSeeTeam && (
        <section aria-labelledby="team-closings" className="space-y-3">
          <h2
            id="team-closings"
            className="text-base font-semibold text-gray-900 dark:text-gray-100"
          >
            {t("team")}
          </h2>
          <TeamClosings canApprove={canApprove} isAdmin={isAdmin} />
        </section>
      )}
    </div>
  );
}

export default function PeriodClosingPage() {
  return (
    <ModuleGuard module="enterprise">
      <PeriodClosingPageContent />
    </ModuleGuard>
  );
}
