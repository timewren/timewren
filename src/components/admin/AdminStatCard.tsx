import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";

const colorClasses = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  green: "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  purple:
    "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400",
} as const;

export function AdminStatCard({
  label,
  value,
  icon: Icon,
  href,
  color = "blue",
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  color?: keyof typeof colorClasses;
}) {
  const content = (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {typeof value === "number" ? value.toLocaleString("da-DK") : value}
          </p>
        </div>
        <div className={`rounded-full p-3 ${colorClasses[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

export type SystemStatus = "ok" | "warning" | "error" | "unknown";

const statusMeta = {
  ok: {
    label: "Sund",
    icon: CheckCircle2,
    badge:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  warning: {
    label: "Advarsel",
    icon: AlertTriangle,
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  error: {
    label: "Fejl",
    icon: AlertTriangle,
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
  unknown: {
    label: "Ukendt",
    icon: Clock,
    badge: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  },
} as const;

export function SystemStatusCard({
  title,
  status,
  description,
  icon: Icon,
}: {
  title: string;
  status: SystemStatus;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const StatusIcon = statusMeta[status].icon;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gray-100 p-2 text-gray-600 dark:bg-gray-700 dark:text-gray-200">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {title}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {description}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta[status].badge}`}
        >
          <StatusIcon className="h-3 w-3" />
          {statusMeta[status].label}
        </span>
      </div>
    </div>
  );
}
