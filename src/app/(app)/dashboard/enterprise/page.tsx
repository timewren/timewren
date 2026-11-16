"use client";

import { Building2, Calendar, Clock, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { CheckInWidget } from "@/components/enterprise/CheckInWidget";
import { ModuleGuard } from "@/components/ModuleGuard";
import { trpc } from "@/providers/trpc-provider";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>
      )}
    </div>
  );
}

function EnterprisePageContent() {
  const t = useTranslations("enterprise.overview");
  const { data: members, isLoading: membersLoading } =
    trpc.enterprise.listMembers.useQuery();
  const { data: requests, isLoading: requestsLoading } =
    trpc.enterprise.listRequests.useQuery();
  const { data: org } = trpc.enterprise.get.useQuery();

  const isLoading = membersLoading || requestsLoading;

  const pendingRequests = useMemo(
    () =>
      requests?.filter((r: { status: string }) => r.status === "pending") ?? [],
    [requests],
  );

  const upcomingAbsences = useMemo(() => {
    if (!requests) return [];
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    return requests.filter((r: { status: string; startDate: string }) => {
      if (r.status !== "approved") return false;
      const start = new Date(r.startDate);
      return start >= now && start <= nextWeek;
    });
  }, [requests]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      {/* Fremmøde check-ind/ud */}
      <CheckInWidget />

      {/* Welcome */}
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 dark:border-brand-600 dark:bg-tt-gran-lys">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("welcome", { name: org?.name ?? t("orgFallback") })}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("intro")}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden">
        <StatCard
          icon={Users}
          label={t("employees")}
          value={members?.length ?? 0}
        />
        <StatCard
          icon={Calendar}
          label={t("pendingRequests")}
          value={pendingRequests.length}
          sub={pendingRequests.length > 0 ? t("needsAction") : t("nonePending")}
        />
        <StatCard
          icon={Clock}
          label={t("upcomingAbsence")}
          value={upcomingAbsences.length}
          sub={t("next7Days")}
        />
      </div>

      {/* Upcoming absences */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-500 dark:text-gray-400">
          {t("upcomingHeading")}
        </h3>
        {upcomingAbsences.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {t("noUpcoming")}
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingAbsences.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{
                      backgroundColor: a.absenceType.color ?? "#6b7280",
                    }}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {a.absenceType.name}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {a.endDate
                        ? t("dateRange", { start: a.startDate, end: a.endDate })
                        : t("openRange", { start: a.startDate })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EnterprisePage() {
  return (
    <ModuleGuard module="enterprise">
      <EnterprisePageContent />
    </ModuleGuard>
  );
}
