"use client";

import {
  Activity,
  Archive,
  Building2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  FileText,
  FolderKanban,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import type { FieldChange } from "@/lib/trpc/routers/activity";
import { trpc } from "@/providers/trpc-provider";

// Entity type icons
const entityIcons: Record<string, React.ReactNode> = {
  client: <Building2 className="h-4 w-4" />,
  project: <FolderKanban className="h-4 w-4" />,
  time_entry: <Clock className="h-4 w-4" />,
  invoice: <FileText className="h-4 w-4" />,
  prepaid_package: <CreditCard className="h-4 w-4" />,
  settings: <Settings className="h-4 w-4" />,
};

// Action icons
const actionIcons: Record<string, React.ReactNode> = {
  create: <Plus className="h-3 w-3" />,
  update: <Pencil className="h-3 w-3" />,
  delete: <Trash2 className="h-3 w-3" />,
  archive: <Archive className="h-3 w-3" />,
  restore: <RotateCcw className="h-3 w-3" />,
  complete: <CheckCircle className="h-3 w-3" />,
  send: <Send className="h-3 w-3" />,
};

type ActivityT = ReturnType<typeof useTranslations<"activity">>;

// Grammatisk køn pr. entitetstype (spansk participium skal passe: m/f/p = flertal)
const entityGender: Record<string, "m" | "f" | "p"> = {
  client: "m",
  project: "m",
  time_entry: "m",
  invoice: "f",
  prepaid_package: "m",
  settings: "p",
};

function formatTime(date: Date, locale: string): string {
  return new Date(date).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: Date, locale: string): string {
  return new Date(date).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatValue(value: unknown, t: ActivityT, locale: string): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? t("yes") : t("no");
  }
  if (typeof value === "number") {
    return value.toLocaleString(locale);
  }
  if (value instanceof Date) {
    return formatDate(value, locale);
  }
  if (typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}/)) {
    return formatDate(new Date(value), locale);
  }
  return String(value);
}

interface ActivityLogItemProps {
  log: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    entityName: string | null;
    changes: unknown;
    metadata: unknown;
    createdAt: Date;
  };
}

function ActivityLogItem({ log }: ActivityLogItemProps) {
  const t = useTranslations("activity");
  const locale = toIntlLocale(useLocale());
  const [expanded, setExpanded] = useState(false);
  const changes = (log.changes as FieldChange[] | null) || [];
  const hasChanges = changes.length > 0;

  const entityIcon = entityIcons[log.entityType] || (
    <Activity className="h-4 w-4" />
  );
  const actionIcon = actionIcons[log.action] || null;
  const entityLabel = t.has(`entity.${log.entityType}`)
    ? t(`entity.${log.entityType}`)
    : log.entityType;
  const gender = entityGender[log.entityType] ?? "m";
  const actionLabel = t.has(`action.${gender}.${log.action}`)
    ? t(`action.${gender}.${log.action}`)
    : log.action;
  const lineChunks = {
    entity: entityLabel,
    name: log.entityName ?? "",
    action: actionLabel,
    e: (chunks: React.ReactNode) => (
      <span className="font-medium">{chunks}</span>
    ),
    n: (chunks: React.ReactNode) => (
      <span className="text-gray-600 dark:text-gray-400">{chunks}</span>
    ),
    a: (chunks: React.ReactNode) => (
      <span className="text-gray-500 dark:text-gray-400">{chunks}</span>
    ),
  };

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-b-0">
      <button
        type="button"
        onClick={() => hasChanges && setExpanded(!expanded)}
        disabled={!hasChanges}
        className={`w-full p-3 text-left transition-colors ${
          hasChanges
            ? "hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
            : "cursor-default"
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Entity icon */}
          <div className="flex-shrink-0 mt-0.5 rounded-full bg-gray-100 dark:bg-gray-700 p-2 text-gray-600 dark:text-gray-400">
            {entityIcon}
          </div>

          <div className="flex-1 min-w-0">
            {/* Main info */}
            <div className="flex items-center gap-2">
              {actionIcon && (
                <span className="text-gray-400 dark:text-gray-500">
                  {actionIcon}
                </span>
              )}
              <span className="text-sm text-gray-900 dark:text-gray-100 break-all">
                {t.rich(log.entityName ? "line" : "lineNoName", lineChunks)}
              </span>
            </div>

            {/* Time */}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {formatTime(log.createdAt, locale)}
            </p>
          </div>

          {/* Expand icon */}
          {hasChanges && (
            <div className="flex-shrink-0 text-gray-400">
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          )}
        </div>
      </button>

      {/* Expanded changes */}
      {expanded && hasChanges && (
        <div className="px-3 pb-3 pl-12">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3 space-y-2">
            {changes.map((change, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
              <div key={idx} className="text-sm">
                <span className="text-gray-500 dark:text-gray-400">
                  {change.fieldLabel}:
                </span>{" "}
                <span className="line-through text-red-500/70 dark:text-red-400/70">
                  {formatValue(change.before, t, locale)}
                </span>{" "}
                <span className="text-gray-400 dark:text-gray-500">→</span>{" "}
                <span className="text-green-600 dark:text-green-400">
                  {formatValue(change.after, t, locale)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ActivityLogWidgetProps {
  entityType?: string;
  entityId?: string;
  limit?: number;
  showHeader?: boolean;
}

export function ActivityLogWidget({
  entityType,
  entityId,
  limit = 20,
  showHeader = true,
}: ActivityLogWidgetProps) {
  const t = useTranslations("activity");
  const locale = toIntlLocale(useLocale());
  const { data: logs, isLoading } = trpc.activity.list.useQuery({
    entityType,
    entityId,
    limit,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {showHeader && (
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 p-4">
            <Activity className="h-5 w-5 text-gray-400" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {t("title")}
            </h3>
          </div>
        )}
        <div className="p-8 text-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      </div>
    );
  }

  // Group logs by date
  const logsByDate = new Map<string, typeof logs>();
  if (logs) {
    for (const log of logs) {
      const dateKey = toLocalDateStr(new Date(log.createdAt));
      if (!logsByDate.has(dateKey)) {
        logsByDate.set(dateKey, []);
      }
      logsByDate.get(dateKey)?.push(log);
    }
  }

  const sortedDates = Array.from(logsByDate.keys()).sort((a, b) =>
    b.localeCompare(a),
  );

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {showHeader && (
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 p-4">
          <Activity className="h-5 w-5 text-brand-500 dark:text-brand-400" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {t("title")}
          </h3>
          {logs && (
            <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
              {t("count", { count: logs.length })}
            </span>
          )}
        </div>
      )}

      {!logs || logs.length === 0 ? (
        <div className="p-8 text-center">
          <Activity className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        </div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto">
          {sortedDates.map((dateKey) => (
            <div key={dateKey}>
              {/* Date header */}
              <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50 px-4 py-2 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                {formatDate(new Date(dateKey), locale)}
              </div>
              {/* Logs for this date */}
              {logsByDate.get(dateKey)?.map((log) => (
                <ActivityLogItem key={log.id} log={log} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
