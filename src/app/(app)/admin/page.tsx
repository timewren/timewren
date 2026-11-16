"use client";

import {
  Activity,
  ArrowUpRight,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { ChurnRiskWidget } from "@/components/admin/ChurnRiskWidget";
import { GrowthWidget } from "@/components/admin/GrowthWidget";
import { useBrand } from "@/components/BrandContext";
import { trpc } from "@/providers/trpc-provider";

function MetricCard({
  label,
  value,
  icon: Icon,
  href,
  color = "blue",
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  href?: string;
  color?: "blue" | "green" | "amber" | "purple";
}) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
    purple: "bg-purple-50 text-purple-600",
  };

  const content = (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
        </div>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${colorMap[color]}`}
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="h-4 w-20 rounded bg-gray-200" />
          <div className="mt-2 h-7 w-16 rounded bg-gray-200" />
        </div>
        <div className="h-9 w-9 rounded-lg bg-gray-100" />
      </div>
    </div>
  );
}

function formatActionLabel(action: string): string {
  const labels: Record<string, string> = {
    view_system_stats: "Viste systemstatistik",
    list_users: "Viste brugerliste",
    view_user_details: "Viste brugerdetaljer",
    view_activity_log: "Viste aktivitetslog",
    flag_user: "Flaggede bruger",
    unflag_user: "Fjernede flag fra bruger",
    delete_user: "Slettede bruger",
    verify_email: "Verificerede email",
    update_user_role: "Opdaterede brugerrolle",
    view_user_growth: "Viste brugervækst",
    view_finance_overview: "Viste økonomi",
  };
  return labels[action] || action.replace(/_/g, " ");
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "Lige nu";
  if (diffMinutes < 60) return `${diffMinutes} min siden`;
  if (diffHours < 24) return `${diffHours} timer siden`;
  if (diffDays < 7) return `${diffDays} dage siden`;
  return date.toLocaleDateString("da-DK", {
    day: "numeric",
    month: "short",
  });
}

export default function AdminDashboardPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const { data: stats, isLoading: statsLoading } =
    trpc.admin.getSystemStats.useQuery();
  const { data: finance, isLoading: financeLoading } =
    trpc.admin.getFinanceOverview.useQuery();
  const { data: recentUsers, isLoading: usersLoading } =
    trpc.admin.listUsers.useQuery({
      limit: 5,
      offset: 0,
      sortBy: "created",
      sortDir: "desc",
    });
  const { data: activityLog, isLoading: activityLoading } =
    trpc.admin.getActivityLog.useQuery({
      limit: 5,
      offset: 0,
    });

  const isLoading = statsLoading || financeLoading;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overblik over {brand.name} systemet
        </p>
      </div>

      {/* Metric cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total brugere"
            value={stats?.totalUsers ?? 0}
            icon={Users}
            href="/admin/users"
            color="blue"
          />
          <MetricCard
            label="Nye denne måned"
            value={stats?.newUsersThisMonth ?? 0}
            icon={UserPlus}
            color="green"
          />
          <MetricCard
            label="MRR"
            value={
              finance
                ? `${Math.round(finance.mrrActual).toLocaleString("da-DK")} kr`
                : "–"
            }
            icon={Wallet}
            href="/admin/finance"
            color="purple"
          />
          <MetricCard
            label="Aktive subscriptions"
            value={finance?.counts.active ?? 0}
            icon={TrendingUp}
            color="amber"
          />
        </div>
      )}

      {/* Revenue & Growth widget — full width, rich metrics */}
      <GrowthWidget />

      {/* Two-column layout for lists */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent signups */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">
              Seneste signups
            </h2>
            <Link
              href="/admin/users"
              className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
            >
              Se alle
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {usersLoading ? (
              <div className="space-y-3 p-5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={`signup-skeleton-${n}`}
                    className="flex animate-pulse items-center gap-3"
                  >
                    <div className="h-8 w-8 rounded-full bg-gray-200" />
                    <div className="flex-1">
                      <div className="h-4 w-32 rounded bg-gray-200" />
                      <div className="mt-1 h-3 w-24 rounded bg-gray-100" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentUsers?.users && recentUsers.users.length > 0 ? (
              recentUsers.users.map((user) => (
                <Link
                  key={user.id}
                  href={`/admin/users/${user.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-700">
                    {(user.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {user.name || "Unavngivet"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {user.createdAt
                        ? formatRelativeTime(
                            typeof user.createdAt === "string"
                              ? user.createdAt
                              : new Date(user.createdAt).toISOString(),
                          )
                        : "–"}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-gray-400">
                Ingen nye signups
              </div>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">
              Seneste aktivitet
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {activityLoading ? (
              <div className="space-y-3 p-5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={`activity-skeleton-${n}`}
                    className="flex animate-pulse items-center gap-3"
                  >
                    <div className="h-8 w-8 rounded-full bg-gray-200" />
                    <div className="flex-1">
                      <div className="h-4 w-48 rounded bg-gray-200" />
                      <div className="mt-1 h-3 w-20 rounded bg-gray-100" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activityLog?.logs && activityLog.logs.length > 0 ? (
              activityLog.logs.map((log) => (
                <div key={log.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                    <Activity className="h-3.5 w-3.5 text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-900">
                      <span className="font-medium">
                        {log.admin?.name || "System"}
                      </span>{" "}
                      {formatActionLabel(log.action)}
                      {log.targetUser?.name && (
                        <span className="text-gray-500">
                          {" "}
                          — {log.targetUser.name}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {log.createdAt
                        ? formatRelativeTime(
                            typeof log.createdAt === "string"
                              ? log.createdAt
                              : new Date(log.createdAt).toISOString(),
                          )
                        : "–"}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-gray-400">
                Ingen aktivitet endnu
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Churn risk widget */}
      <ChurnRiskWidget />
    </div>
  );
}
