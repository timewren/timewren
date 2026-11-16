"use client";

import { ArrowLeft, Briefcase, History, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { use, useState } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { AbsenceRequestList } from "@/components/enterprise/AbsenceRequestList";
import { AuditEntryList } from "@/components/enterprise/AuditEntryList";
import { EmployeeHeader } from "@/components/enterprise/EmployeeHeader";
import { EmploymentTimeline } from "@/components/enterprise/EmploymentTimeline";
import { FlexBalance } from "@/components/enterprise/FlexBalance";
import { VacationAdjustForm } from "@/components/enterprise/VacationAdjustForm";
import { VacationBalance } from "@/components/enterprise/VacationBalance";
import { VacationLedgerList } from "@/components/enterprise/VacationLedgerList";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { Button } from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { roleSatisfies } from "@/lib/permissions/org-role";
import { trpc } from "@/providers/trpc-provider";

const HISTORY_PAGE = 50;

/**
 * Historik-fanen (#466): alle org-audit-poster med medarbejderen som mål —
 * fravær, saldi, profilændringer, timesedler, support-adgang. Nyeste først.
 */
function EmployeeHistory({ profileId }: { profileId: string }) {
  const t = useTranslations("enterprise.employees.detail");
  const [offset, setOffset] = useState(0);
  const [pages, setPages] = useState<
    Parameters<typeof AuditEntryList>[0]["entries"]
  >([]);
  // Ingen placeholderData: forrige side som placeholder ville kortvarigt
  // vise sidste side dobbelt (pages + placeholder) mens næste side hentes.
  const { data, isLoading } = trpc.enterprise.getProfileHistory.useQuery({
    id: profileId,
    limit: HISTORY_PAGE,
    offset,
  });
  const entries = offset === 0 ? (data ?? []) : [...pages, ...(data ?? [])];

  if (isLoading && offset === 0) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        {["a", "b", "c", "d"].map((k) => (
          <div
            key={k}
            className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
      <AuditEntryList entries={entries} emptyText={t("historyEmpty")} />
      {data && data.length === HISTORY_PAGE && (
        <div className="border-t border-gray-200 px-4 py-3 text-center dark:border-gray-700">
          <button
            type="button"
            onClick={() => {
              setPages(entries);
              setOffset((o) => o + HISTORY_PAGE);
            }}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("loadMore")}
          </button>
        </div>
      )}
      <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500">
        {t("historyNote")}
      </p>
    </div>
  );
}

function EmployeeDetailContent({ id }: { id: string }) {
  const t = useTranslations("enterprise.employees.detail");
  const { data: session } = useSession();
  const [tab, setTab] = useState<"overview" | "employment" | "history">(
    "overview",
  );
  const { data: profile, isLoading } = trpc.enterprise.getProfileById.useQuery({
    id,
  });

  const isOwnProfile = profile?.userId === session?.user?.id;

  // Feriesaldo for egen profil eller en medarbejder man må håndtere fravær
  // for (serveren afgør; #461). Flex er stadig kun egen.
  const { data: vacationBalance } = trpc.enterprise.getVacationBalance.useQuery(
    { userId: profile?.userId },
    { enabled: !!profile?.userId, retry: false },
  );
  const { data: myRole } = trpc.rolePermissions.getMyRole.useQuery(undefined, {
    staleTime: 60_000,
    retry: 1,
  });
  const canAdjustVacation =
    roleSatisfies(myRole?.role, "admin") && !!profile?.userId;
  const { data: flexBalance } = trpc.enterprise.getBalance.useQuery(undefined, {
    enabled: isOwnProfile,
  });
  const { data: requests } = trpc.enterprise.listRequests.useQuery(undefined, {
    enabled: isOwnProfile,
  });
  const { data: compliance } = trpc.enterprise.getEmployeeCompliance.useQuery({
    employeeProfileId: id,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("employee")} />
        <div className="animate-pulse space-y-4">
          <div className="h-32 rounded-lg bg-gray-100 dark:bg-gray-800" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-40 rounded-lg bg-gray-100 dark:bg-gray-800" />
            <div className="h-40 rounded-lg bg-gray-100 dark:bg-gray-800" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("employee")} />
        <div className="rounded-xl border border-dashed border-gray-200 p-12 text-center dark:border-gray-800">
          <p className="text-gray-500 dark:text-gray-400">{t("notFound")}</p>
          <Link href="/dashboard/enterprise/employees">
            <Button variant="ghost" className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("backToEmployees")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.user?.name ?? t("employee")}
        actions={
          <Link href="/dashboard/enterprise/employees">
            <Button variant="ghost">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("back")}
            </Button>
          </Link>
        }
      />

      {/* Faner (#466, #465): Overblik | Ansættelse | Historik */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {(
          [
            { key: "overview", label: t("tabOverview") },
            { key: "employment", label: t("tabEmployment") },
            { key: "history", label: t("tabHistory") },
          ] as const
        ).map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => setTab(tabItem.key)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === tabItem.key
                ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tabItem.key === "employment" && <Briefcase className="h-4 w-4" />}
            {tabItem.key === "history" && <History className="h-4 w-4" />}
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <EmployeeHistory profileId={id} />
      ) : tab === "employment" ? (
        <EmploymentTimeline
          profileId={id}
          canEdit={roleSatisfies(myRole?.role, "admin")}
        />
      ) : (
        <>
          {/* Profile header */}
          <EmployeeHeader
            name={profile.user?.name ?? t("unknown")}
            email={profile.user?.email}
            role={profile.role}
            department={profile.department}
            employmentType={profile.employmentType ?? "fulltime"}
            weeklyHours={Number(profile.weeklyHours ?? 37)}
            startDate={profile.startDate}
          />

          {/* Balance cards — ferie for egen profil og medarbejdere man må
              håndtere fravær for; flex kun egen (#461) */}
          {(isOwnProfile || (vacationBalance?.length ?? 0) > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {vacationBalance &&
              Array.isArray(vacationBalance) &&
              vacationBalance.length > 0 ? (
                vacationBalance.map((b) => (
                  <VacationBalance key={b.id} balance={b} />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  {t("noVacation")}
                </div>
              )}

              {isOwnProfile &&
                (flexBalance ? (
                  <FlexBalance balance={Number(flexBalance.balance ?? 0)} />
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    {t("noFlex")}
                  </div>
                ))}
            </div>
          )}

          {/* Feriebevægelser + manuel justering (admin) — #461 */}
          {profile?.userId && (vacationBalance?.length ?? 0) > 0 && (
            <VacationLedgerList userId={profile.userId} />
          )}
          {canAdjustVacation && profile?.userId && (
            <VacationAdjustForm userId={profile.userId} />
          )}

          {/* Compliance summary */}
          {compliance && (
            <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("compliance")}
                </h3>
              </div>
              {compliance.exempt ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
                  {t("exempt")}
                </span>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("weeklyAverage")}
                      </p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t("hoursPerWeek", {
                          hours:
                            compliance.weeklyAverage.averageHoursPerWeek.toFixed(
                              1,
                            ),
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("dailyRest")}
                      </p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {compliance.dailyRestViolations.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("weeklyRest")}
                      </p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {compliance.weeklyRestViolations.length}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      {compliance.overallStatus === "ok" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          {t("statusOk")}
                        </span>
                      ) : compliance.overallStatus === "warning" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          {t("statusWarning")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          {t("statusViolation")}
                        </span>
                      )}
                    </div>
                    <Link
                      href="/dashboard/enterprise/compliance"
                      className="text-sm text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300"
                    >
                      {t("seeCompliance")}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Absence history — only shown for own profile (query uses logged-in user) */}
          {isOwnProfile && (
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("absenceHistory")}
              </h3>
              <AbsenceRequestList requests={requests ?? []} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="manager">
        <EmployeeDetailContent id={id} />
      </RoleGuard>
    </ModuleGuard>
  );
}
