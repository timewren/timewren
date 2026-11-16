"use client";

import { AlertTriangle, ArrowUpRight, Mail } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/providers/trpc-provider";

function RiskBadge({ level }: { level: "high" | "medium" | "low" }) {
  if (level === "high") {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Hoj
      </span>
    );
  }
  if (level === "medium") {
    return (
      <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
        Middel
      </span>
    );
  }
  return null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ChurnRiskWidget() {
  const { data, isLoading } = trpc.admin.getChurnRisk.useQuery({ limit: 10 });

  const atRiskUsers = data?.filter((u) => u.riskScore >= 40) ?? [];

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Churn-risiko
          </h2>
        </div>
        <Link
          href="/admin/users?segment=churn_high"
          className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          Se alle
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Body */}
      <div className="divide-y divide-gray-50 dark:divide-gray-700">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
                key={`churn-skeleton-${i}`}
                className="flex animate-pulse items-center gap-3"
              >
                <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1">
                  <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="mt-1 h-3 w-24 rounded bg-gray-100 dark:bg-gray-600" />
                </div>
                <div className="h-5 w-12 rounded-full bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        ) : atRiskUsers.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            Ingen brugere med forhojet churn-risiko
          </div>
        ) : (
          atRiskUsers.map((user) => (
            <div
              key={user.userId}
              className="flex items-center gap-3 px-5 py-3"
            >
              {/* Avatar */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {getInitials(user.name)}
              </div>

              {/* Name + reason */}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/users/${user.userId}`}
                  className="truncate text-sm font-medium text-gray-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                >
                  {user.name}
                </Link>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {user.reasons[0] ?? "Ukendt arsag"}
                </p>
              </div>

              {/* Risk badge */}
              <RiskBadge level={user.riskLevel} />

              {/* Contact button */}
              <a
                href={`mailto:${user.email}`}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                title={`Send email til ${user.name}`}
              >
                <Mail className="h-3.5 w-3.5" />
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
