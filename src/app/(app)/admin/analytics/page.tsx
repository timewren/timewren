"use client";

import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Clock,
  CreditCard,
  FileText,
  Globe,
  Monitor,
  MousePointerClick,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  AdminChart,
  AdminFunnel,
  AdminProgressBar,
  AdminStatCard,
  RefreshIndicator,
} from "@/components/admin";
import { useIncludeTestAccounts } from "@/components/admin/TestAccountFilter";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

type Tab = "oversigt" | "engagement" | "adoption" | "traffic";
type DateRange = "day" | "7d" | "30d" | "6mo" | "12mo";

const dateRangeLabels: Record<DateRange, string> = {
  day: "24 timer",
  "7d": "7 dage",
  "30d": "30 dage",
  "6mo": "6 maaneder",
  "12mo": "12 maaneder",
};

export default function AnalyticsPage() {
  const includeTestAccounts = useIncludeTestAccounts();
  const [activeTab, setActiveTab] = useState<Tab>("oversigt");
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [deviceDimension, setDeviceDimension] = useState<
    "device" | "browser" | "os"
  >("device");
  const utils = trpc.useUtils();

  // Oversigt queries
  const { data: growthData, isLoading: loadingGrowth } =
    trpc.admin.getUserGrowthData.useQuery(
      { includeTestAccounts, monthsBack: 12 },
      { enabled: activeTab === "oversigt" },
    );
  const { data: featureUsage, isLoading: loadingFeatures } =
    trpc.admin.getFeatureUsageStats.useQuery(
      { includeTestAccounts },
      {
        enabled: activeTab === "oversigt",
      },
    );
  const { data: revenueData, isLoading: loadingRevenue } =
    trpc.admin.getRevenueTrends.useQuery(
      { includeTestAccounts, monthsBack: 12 },
      { enabled: activeTab === "oversigt" },
    );

  // Engagement queries
  const { data: activeUserCounts } = trpc.admin.getActiveUserCounts.useQuery(
    { includeTestAccounts, daysBack: 30 },
    { enabled: activeTab === "engagement" },
  );
  const { data: engagementStats, isLoading: loadingEngagement } =
    trpc.admin.getUserEngagementStats.useQuery(
      { includeTestAccounts, limit: 15 },
      { enabled: activeTab === "engagement" },
    );
  const { data: retentionCohorts, isLoading: loadingRetention } =
    trpc.admin.getUserRetentionCohorts.useQuery(
      { includeTestAccounts, months: 6 },
      { enabled: activeTab === "engagement" },
    );

  // Adoption queries
  const { data: funnelData, isLoading: loadingFunnel } =
    trpc.admin.getOnboardingFunnel.useQuery(
      { includeTestAccounts },
      {
        enabled: activeTab === "adoption",
      },
    );
  const { data: adoptionRates, isLoading: loadingAdoption } =
    trpc.admin.getFeatureAdoptionRates.useQuery(
      { includeTestAccounts },
      {
        enabled: activeTab === "adoption",
      },
    );

  // Traffic queries (Plausible)
  const { data: isConfigured } = trpc.plausible.isConfigured.useQuery();
  const plausibleEnabled = isConfigured === true && activeTab === "traffic";
  const { data: realtimeVisitors } = trpc.plausible.realtimeVisitors.useQuery(
    undefined,
    { refetchInterval: 15_000, enabled: plausibleEnabled },
  );
  const { data: aggregateStats, error: aggregateError } =
    trpc.plausible.getAggregateStats.useQuery(
      { dateRange },
      { enabled: plausibleEnabled, retry: false },
    );
  const { data: timeseries, isLoading: loadingTimeseries } =
    trpc.plausible.getVisitorTimeseries.useQuery(
      { dateRange },
      { enabled: plausibleEnabled, retry: false },
    );
  const { data: topPages, isLoading: loadingPages } =
    trpc.plausible.getTopPages.useQuery(
      { dateRange, limit: 10 },
      { enabled: plausibleEnabled, retry: false },
    );
  const { data: trafficSources, isLoading: loadingSources } =
    trpc.plausible.getTrafficSources.useQuery(
      { dateRange, limit: 10 },
      { enabled: plausibleEnabled, retry: false },
    );
  const { data: devices, isLoading: loadingDevices } =
    trpc.plausible.getDeviceBreakdown.useQuery(
      { dateRange, dimension: deviceDimension },
      { enabled: plausibleEnabled, retry: false },
    );
  const { data: countries, isLoading: loadingCountries } =
    trpc.plausible.getCountryBreakdown.useQuery(
      { dateRange, limit: 10 },
      { enabled: plausibleEnabled, retry: false },
    );

  const handleRefresh = () => {
    utils.admin.invalidate();
    utils.plausible.invalidate();
  };

  const formatCurrency = (value: string | number | null) => {
    if (!value) return "0 DKK";
    const num = typeof value === "string" ? parseFloat(value) : value;
    return new Intl.NumberFormat("da-DK", {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: 0,
    }).format(num);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const tabs: {
    key: Tab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { key: "oversigt", label: "Oversigt", icon: BarChart3 },
    { key: "engagement", label: "Engagement", icon: Users },
    { key: "adoption", label: "Adoption", icon: TrendingUp },
    { key: "traffic", label: "Trafik", icon: Globe },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
          <p className="mt-1 text-gray-500 text-sm">
            Overblik over brugervaekst, engagement og feature-adoption
          </p>
        </div>
        <RefreshIndicator onRefresh={handleRefresh} />
      </div>

      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-gray-900 shadow"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Oversigt */}
      {activeTab === "oversigt" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Feature Brug</h2>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-5">
              {[
                {
                  icon: Timer,
                  color: "amber",
                  value: featureUsage?.activeTimers ?? 0,
                  label: "Aktive timers",
                },
                {
                  icon: Clock,
                  color: "green",
                  value: featureUsage?.activePrepaidPackages ?? 0,
                  label: "Klippekort",
                },
                {
                  icon: CreditCard,
                  color: "blue",
                  value: featureUsage?.paidInvoices ?? 0,
                  label: "Betalte fakturaer",
                },
                {
                  icon: Calendar,
                  color: "purple",
                  value: featureUsage?.calendarConnections ?? 0,
                  label: "Kalender sync",
                },
                {
                  icon: FileText,
                  color: "indigo",
                  value: featureUsage?.extensionUsers ?? 0,
                  label: "Extension brugere",
                },
              ].map(({ icon: Icon, color, value, label }) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 rounded-lg bg-${color}-50 p-4`}
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full bg-${color}-100`}
                  >
                    <Icon className={`h-5 w-5 text-${color}-600`} />
                  </div>
                  <div>
                    <p className={`text-2xl font-bold text-${color}-600`}>
                      {loadingFeatures ? "..." : value}
                    </p>
                    <p className={`text-sm text-${color}-700`}>{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center gap-2 border-b border-gray-200 p-4">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <h2 className="font-semibold text-gray-900">
                Brugervaekst (12 maaneder)
              </h2>
            </div>
            <div className="p-4">
              <AdminChart
                data={
                  growthData?.map((m) => ({
                    label: m.month.slice(5),
                    value: m.count,
                    displayValue: String(m.count),
                  })) ?? []
                }
                color="green"
                height={256}
                isLoading={loadingGrowth}
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center gap-2 border-b border-gray-200 p-4">
              <BarChart3 className="h-5 w-5 text-brand-500" />
              <h2 className="font-semibold text-gray-900">
                Omsaetning (12 maaneder)
              </h2>
            </div>
            <div className="p-4">
              <AdminChart
                data={
                  revenueData?.map((m) => ({
                    label: m.month.slice(5),
                    value: parseFloat(m.total ?? "0"),
                    displayValue: String(m.count),
                  })) ?? []
                }
                color="blue"
                height={256}
                isLoading={loadingRevenue}
                emptyMessage="Ingen omsaetningsdata endnu"
              />
            </div>
            {revenueData && revenueData.length > 0 && (
              <div className="border-t border-gray-200 p-4">
                <p className="text-sm text-gray-600">
                  Total omsaetning (12 mdr):{" "}
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(
                      revenueData.reduce(
                        (sum, m) => sum + parseFloat(m.total ?? "0"),
                        0,
                      ),
                    )}
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Engagement */}
      {activeTab === "engagement" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                label: "DAU (daglige aktive)",
                value: activeUserCounts?.dau ?? 0,
              },
              {
                label: "WAU (ugentlige aktive)",
                value: activeUserCounts?.wau ?? 0,
              },
              {
                label: "MAU (maanedlige aktive)",
                value: activeUserCounts?.mau ?? 0,
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg border border-gray-200 bg-white p-6"
              >
                <p className="text-sm text-gray-500">{label}</p>
                <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">
                Engagement Leaderboard (30 dage)
              </h2>
            </div>
            <div className="overflow-x-auto">
              {loadingEngagement ? (
                <div className="flex items-center justify-center py-8">
                  <InlineSpinner className="h-8 w-8" />
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        #
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        Bruger
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        Sessions
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        Tidsposter
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        Opgaver
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        Score
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {engagementStats?.map((user, i) => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-500">
                          {i + 1}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="text-sm font-medium text-brand-600 hover:underline"
                          >
                            {user.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {user.sessionCount}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {user.timeEntryCount}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {user.taskCount}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
                            {user.engagementScore}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">
                Retention Kohorter
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Brugere der vender tilbage i efterfoelgende maaneder
              </p>
            </div>
            <div className="overflow-x-auto p-4">
              {loadingRetention ? (
                <div className="flex items-center justify-center py-8">
                  <InlineSpinner className="h-8 w-8" />
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Kohorte
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Signups
                      </th>
                      {[1, 2, 3, 4, 5].map((m) => (
                        <th
                          key={`month-header-${m}`}
                          className="px-3 py-2 text-center text-xs font-medium text-gray-500"
                        >
                          Mdr {m}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {retentionCohorts?.map((cohort) => (
                      <tr key={cohort.cohortMonth}>
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">
                          {cohort.cohortMonth}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600">
                          {cohort.signupCount}
                        </td>
                        {[0, 1, 2, 3, 4].map((monthIdx) => {
                          const retained = cohort.retention[monthIdx];
                          const pct =
                            cohort.signupCount > 0 && retained !== undefined
                              ? Math.round(
                                  (retained / cohort.signupCount) * 100,
                                )
                              : null;
                          return (
                            <td
                              key={`ret-${cohort.cohortMonth}-month-${monthIdx + 1}`}
                              className="px-3 py-2 text-center text-sm"
                            >
                              {pct !== null ? (
                                <span
                                  className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${pct >= 50 ? "bg-green-100 text-green-800" : pct >= 25 ? "bg-amber-100 text-amber-800" : pct > 0 ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-500"}`}
                                >
                                  {pct}%
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Adoption */}
      {activeTab === "adoption" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Onboarding Funnel</h2>
              <p className="mt-1 text-sm text-gray-500">
                Brugerrejse fra signup til foerste faktura
              </p>
            </div>
            <div className="p-4">
              <AdminFunnel steps={funnelData ?? []} isLoading={loadingFunnel} />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Feature Adoption</h2>
              <p className="mt-1 text-sm text-gray-500">
                Andel af brugere der har brugt hver feature
              </p>
            </div>
            <div className="p-4">
              {loadingAdoption ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }, (_, i) => `skeleton-${i}`).map(
                    (key) => (
                      <div
                        key={key}
                        className="h-10 animate-pulse rounded bg-gray-200"
                      />
                    ),
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {adoptionRates?.map((rate, i) => {
                    const colors: Array<
                      "blue" | "green" | "amber" | "purple" | "rose"
                    > = ["blue", "green", "amber", "purple", "rose"];
                    return (
                      <AdminProgressBar
                        key={rate.feature}
                        label={rate.feature}
                        value={rate.users}
                        max={rate.total}
                        color={colors[i % colors.length]}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Traffic (Plausible) */}
      {activeTab === "traffic" &&
        (isConfigured === false ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
            <h2 className="font-semibold text-amber-800">
              Plausible ikke konfigureret
            </h2>
            <p className="mt-2 text-sm text-amber-700">
              Tilfoej <code>PLAUSIBLE_API_KEY</code>,{" "}
              <code>PLAUSIBLE_BASE_URL</code>, og <code>PLAUSIBLE_SITE_ID</code>{" "}
              til dine miljovariabler.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {realtimeVisitors != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  {realtimeVisitors} online nu
                </span>
              )}
            </div>

            <div className="flex gap-2">
              {(Object.keys(dateRangeLabels) as DateRange[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setDateRange(range)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${dateRange === range ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  {dateRangeLabels[range]}
                </button>
              ))}
            </div>

            {aggregateError && (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                <div>
                  <h3 className="font-medium text-red-800">
                    Fejl ved hentning af Plausible-data
                  </h3>
                  <p className="mt-1 text-sm text-red-700">
                    {aggregateError.message}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <AdminStatCard
                label="Unikke besoegende"
                value={aggregateStats?.visitors ?? 0}
                icon={Users}
                color="blue"
              />
              <AdminStatCard
                label="Sidevisninger"
                value={aggregateStats?.pageviews ?? 0}
                icon={MousePointerClick}
                color="green"
              />
              <AdminStatCard
                label="Besoeg"
                value={aggregateStats?.visits ?? 0}
                icon={TrendingUp}
                color="purple"
              />
              <AdminStatCard
                label="Bounce rate"
                value={aggregateStats ? `${aggregateStats.bounceRate}%` : "0%"}
                icon={BarChart3}
                color="amber"
              />
              <AdminStatCard
                label="Gns. besogstid"
                value={
                  aggregateStats
                    ? formatDuration(aggregateStats.visitDuration)
                    : "0m 0s"
                }
                icon={Globe}
                color="rose"
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b border-gray-200 p-4">
                <TrendingUp className="h-5 w-5 text-brand-500" />
                <h2 className="font-semibold text-gray-900">
                  Besoegende over tid
                </h2>
              </div>
              <div className="p-4">
                <AdminChart
                  data={
                    timeseries?.map((t) => ({
                      label: t.date.slice(5, 10),
                      value: t.visitors,
                      displayValue: String(t.visitors),
                    })) ?? []
                  }
                  color="blue"
                  height={256}
                  isLoading={loadingTimeseries}
                  emptyMessage="Ingen besoegsdata for denne periode"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="border-b border-gray-200 p-4">
                  <h2 className="font-semibold text-gray-900">Top sider</h2>
                </div>
                <div className="p-4">
                  {loadingPages ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }, (_, i) => `p-${i}`).map(
                        (k) => (
                          <div
                            key={k}
                            className="h-8 animate-pulse rounded bg-gray-200"
                          />
                        ),
                      )}
                    </div>
                  ) : topPages && topPages.length > 0 ? (
                    <div className="space-y-2">
                      {topPages.map((p) => (
                        <AdminProgressBar
                          key={p.page}
                          label={p.page}
                          value={p.visitors}
                          max={topPages[0].visitors}
                          color="blue"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Ingen data</p>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="border-b border-gray-200 p-4">
                  <h2 className="font-semibold text-gray-900">Trafikkilder</h2>
                </div>
                <div className="p-4">
                  {loadingSources ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }, (_, i) => `s-${i}`).map(
                        (k) => (
                          <div
                            key={k}
                            className="h-8 animate-pulse rounded bg-gray-200"
                          />
                        ),
                      )}
                    </div>
                  ) : trafficSources && trafficSources.length > 0 ? (
                    <div className="space-y-2">
                      {trafficSources.map((s) => (
                        <AdminProgressBar
                          key={s.source}
                          label={s.source}
                          value={s.visitors}
                          max={trafficSources[0].visitors}
                          color="green"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Ingen data</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-200 p-4">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-5 w-5 text-gray-500" />
                    <h2 className="font-semibold text-gray-900">
                      {deviceDimension === "device"
                        ? "Enheder"
                        : deviceDimension === "browser"
                          ? "Browsere"
                          : "Styresystemer"}
                    </h2>
                  </div>
                  <div
                    role="tablist"
                    aria-label="Skift dimension"
                    className="flex gap-1"
                  >
                    {(["device", "browser", "os"] as const).map((dim) => (
                      <button
                        key={dim}
                        type="button"
                        role="tab"
                        aria-selected={deviceDimension === dim}
                        onClick={() => setDeviceDimension(dim)}
                        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${deviceDimension === dim ? "bg-brand-100 text-brand-700" : "text-gray-500 hover:text-gray-700"}`}
                      >
                        {dim === "device"
                          ? "Enhed"
                          : dim === "browser"
                            ? "Browser"
                            : "OS"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-4">
                  {loadingDevices ? (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }, (_, i) => `d-${i}`).map(
                        (k) => (
                          <div
                            key={k}
                            className="h-8 animate-pulse rounded bg-gray-200"
                          />
                        ),
                      )}
                    </div>
                  ) : devices && devices.length > 0 ? (
                    <div className="space-y-2">
                      {devices.map((d) => (
                        <AdminProgressBar
                          key={d.name}
                          label={d.name}
                          value={d.visitors}
                          max={aggregateStats?.visitors || 1}
                          color="purple"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Ingen data</p>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="flex items-center gap-2 border-b border-gray-200 p-4">
                  <Globe className="h-5 w-5 text-gray-500" />
                  <h2 className="font-semibold text-gray-900">Lande</h2>
                </div>
                <div className="p-4">
                  {loadingCountries ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }, (_, i) => `c-${i}`).map(
                        (k) => (
                          <div
                            key={k}
                            className="h-8 animate-pulse rounded bg-gray-200"
                          />
                        ),
                      )}
                    </div>
                  ) : countries && countries.length > 0 ? (
                    <div className="space-y-2">
                      {countries.map((c) => (
                        <AdminProgressBar
                          key={c.country}
                          label={c.country}
                          value={c.visitors}
                          max={countries[0].visitors}
                          color="amber"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Ingen data</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}
