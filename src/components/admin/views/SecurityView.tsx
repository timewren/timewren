"use client";

import {
  AlertTriangle,
  Ban,
  Flag,
  Globe,
  LogIn,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { trpc } from "@/providers/trpc-provider";

function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Ukendt";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return ua.slice(0, 30);
}

function Stat({
  label,
  value,
  icon: Icon,
  color = "blue",
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: "blue" | "red" | "amber" | "green" | "gray";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-green-50 text-green-600",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
        </div>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[color]}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  count,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
        {typeof count === "number" && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {count}
          </span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function SecurityView() {
  const { data, isLoading } = trpc.admin.security.getOverview.useQuery({
    daysBack: 14,
  });
  const { data: auditTrail } =
    trpc.admin.security.getSecurityAuditTrail.useQuery({
      daysBack: 14,
      limit: 30,
    });

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Summary stats */}
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Stat
              label="Logins (14d)"
              value={data.summary.totalSessions}
              icon={LogIn}
              color="blue"
            />
            <Stat
              label="Aktive sessions"
              value={data.summary.activeSessions}
              icon={LogIn}
              color="green"
            />
            <Stat
              label="Unikke brugere"
              value={data.summary.uniqueLoginUsers}
              icon={Users}
              color="blue"
            />
            <Stat
              label="Impersonation"
              value={data.summary.impersonationCount}
              icon={ShieldAlert}
              color="amber"
            />
            <Stat
              label="Flagget"
              value={data.summary.flaggedUsers}
              icon={Flag}
              color="amber"
            />
            <Stat
              label="Banned"
              value={data.summary.bannedUsers}
              icon={Ban}
              color="red"
            />
            <Stat
              label="Delte IP'er"
              value={data.summary.sharedIpCount}
              icon={Globe}
              color="gray"
            />
          </div>

          {/* Alert if impersonation active */}
          {data.impersonationSessions.length > 0 && (
            <Section
              title="Aktiv impersonation"
              icon={ShieldAlert}
              count={data.impersonationSessions.length}
            >
              <ul className="divide-y divide-gray-100">
                {data.impersonationSessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        Admin → bruger{" "}
                        <Link
                          href={`/admin/users/${s.userId}`}
                          className="text-brand-600 hover:underline"
                        >
                          {s.userId.slice(0, 8)}
                        </Link>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        IP: {s.ipAddress ?? "—"} · {parseUserAgent(s.userAgent)}{" "}
                        · {formatDateTime(s.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Recent logins */}
          <Section
            title="Seneste logins"
            icon={LogIn}
            count={data.recentLogins.length}
          >
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Tidspunkt
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Bruger
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      IP
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Enhed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.recentLogins.slice(0, 20).map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                        {formatDateTime(s.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          href={`/admin/users/${s.userId}`}
                          className="text-brand-600 hover:underline"
                        >
                          {s.userName || s.userEmail || s.userId.slice(0, 8)}
                        </Link>
                        {s.userRole && s.userRole !== "user" && (
                          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                            {s.userRole}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                        {s.ipAddress ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                        {parseUserAgent(s.userAgent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Top IPs */}
          <Section title="Top IP-adresser" icon={Globe}>
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      IP
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      Logins
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      Unikke brugere
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.topIps.map((ip) => (
                    <tr
                      key={ip.ipAddress}
                      className={
                        Number(ip.uniqueUsers) > 1
                          ? "bg-amber-50/30"
                          : undefined
                      }
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-900">
                        {ip.ipAddress}
                        {Number(ip.uniqueUsers) > 1 && (
                          <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                            <AlertTriangle className="h-3 w-3" />
                            delt
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">
                        {ip.loginCount}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">
                        {ip.uniqueUsers}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Audit trail */}
          <Section
            title="Sikkerheds-audit trail"
            icon={ShieldCheck}
            count={auditTrail?.length ?? 0}
          >
            {auditTrail && auditTrail.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {auditTrail.map((log) => (
                  <li
                    key={log.id}
                    className="flex items-start justify-between py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">
                        {log.adminName || log.adminEmail || "Admin"} ·{" "}
                        <span className="font-mono text-xs text-gray-600">
                          {log.action}
                        </span>
                      </p>
                      {log.targetUserId && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          Target:{" "}
                          <Link
                            href={`/admin/users/${log.targetUserId}`}
                            className="text-brand-600 hover:underline"
                          >
                            {log.targetUserId.slice(0, 8)}
                          </Link>
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-gray-500">
                      {formatDateTime(log.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">
                Ingen sikkerhedshandlinger i perioden
              </p>
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
