import { Briefcase, Clock, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { dkkCurrencyFormatter } from "@/lib/format";

interface Entry {
  hours: string;
  roundedHours?: string;
  isBillable: boolean | null;
  clientId: string | null;
  projectId: string | null;
  project?: {
    hourlyRate: string | null;
    clientId: string | null;
    client?: {
      id: string;
      name: string;
      defaultHourlyRate: string | null;
    } | null;
    name: string;
  } | null;
  client?: {
    id: string;
    name: string;
    defaultHourlyRate: string | null;
  } | null;
}

interface WeekSummaryProps {
  entries: Entry[];
  userDefaultRate: string | null;
}

interface ClientSummary {
  id: string;
  name: string;
  hours: number;
  revenue: number;
}

export function WeekSummary({ entries, userDefaultRate }: WeekSummaryProps) {
  const t = useTranslations("calendar");
  const hourUnit = t("units.hour");
  const summary = useMemo(() => {
    let totalHours = 0;
    let clientHours = 0;
    let internalHours = 0;
    let totalRevenue = 0;
    const clientMap = new Map<string, ClientSummary>();

    for (const entry of entries) {
      const hours = Number.parseFloat(entry.roundedHours ?? entry.hours);
      totalHours += hours;

      const clientName =
        entry.client?.name ?? entry.project?.client?.name ?? null;
      const resolvedClientId =
        entry.clientId ?? entry.project?.clientId ?? null;

      if (!resolvedClientId) {
        internalHours += hours;
        continue;
      }

      clientHours += hours;

      let rate = 0;
      if (entry.isBillable !== false) {
        if (entry.project?.hourlyRate) {
          rate = Number.parseFloat(entry.project.hourlyRate);
        } else if (entry.project?.client?.defaultHourlyRate) {
          rate = Number.parseFloat(entry.project.client.defaultHourlyRate);
        } else if (entry.client?.defaultHourlyRate) {
          rate = Number.parseFloat(entry.client.defaultHourlyRate);
        } else if (userDefaultRate) {
          rate = Number.parseFloat(userDefaultRate);
        }
      }

      const revenue = hours * rate;
      totalRevenue += revenue;

      const key = resolvedClientId;
      const existing = clientMap.get(key);
      if (existing) {
        existing.hours += hours;
        existing.revenue += revenue;
      } else {
        clientMap.set(key, {
          id: key,
          name: clientName || t("weekSummary.unknownClient"),
          hours,
          revenue,
        });
      }
    }

    const clients = [...clientMap.values()].sort((a, b) => b.hours - a.hours);

    return { totalHours, clientHours, internalHours, totalRevenue, clients };
  }, [entries, userDefaultRate, t]);

  if (summary.totalHours === 0) return null;

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      {/* Total */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <Clock className="h-4 w-4 text-gray-400" />
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("weekSummary.weekTotal")}
          </p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatHours(summary.totalHours, hourUnit)}
          </p>
        </div>
      </div>

      {/* Clients */}
      {summary.clientHours > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
          <Briefcase className="h-4 w-4 text-brand-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("weekSummary.client")}
            </p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {formatHours(summary.clientHours, hourUnit)}
            </p>
          </div>
        </div>
      )}

      {/* Internal */}
      {summary.internalHours > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
          <User className="h-4 w-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("weekSummary.internal")}
            </p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {formatHours(summary.internalHours, hourUnit)}
            </p>
          </div>
        </div>
      )}

      {/* Revenue */}
      {summary.totalRevenue > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-950/30">
          <span className="text-sm font-bold text-green-500">
            {t("weekSummary.currencySymbol")}
          </span>
          <div>
            <p className="text-xs text-green-600 dark:text-green-400">
              {t("weekSummary.revenue")}
            </p>
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">
              {formatCurrency(summary.totalRevenue)}
            </p>
          </div>
        </div>
      )}

      {/* Client breakdown */}
      {summary.clients.length > 1 && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {summary.clients.map((c) => (
              <span
                key={c.id}
                className="text-xs text-gray-600 dark:text-gray-300"
              >
                <span className="font-medium">{c.name}</span>{" "}
                <span className="text-gray-400">
                  {formatHours(c.hours, hourUnit)}
                  {c.revenue > 0 && ` · ${formatCurrency(c.revenue)}`}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatHours(h: number, hourUnit: string): string {
  const rounded = Math.round(h * 10) / 10;
  return `${rounded.toFixed(1).replace(".0", "")}${hourUnit}`;
}

function formatCurrency(amount: number): string {
  return dkkCurrencyFormatter.format(Math.round(amount));
}
