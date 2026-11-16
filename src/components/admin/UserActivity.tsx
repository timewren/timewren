"use client";

import {
  AlertTriangle,
  Calendar,
  Clock,
  CreditCard,
  Download,
  FileText,
  Fingerprint,
  FolderKanban,
  History,
  LogIn,
  MessageSquare,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UserPlus,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

interface UserActivityProps {
  userId: string;
  activeTab: string;
}

type IconMeta = {
  icon: React.ElementType;
  bg: string;
  fg: string;
};

const ICONS: Record<string, IconMeta> = {
  signup: { icon: UserPlus, bg: "bg-blue-100", fg: "text-blue-600" },
  email_verified: {
    icon: ShieldCheck,
    bg: "bg-green-100",
    fg: "text-green-600",
  },
  subscription_started: {
    icon: CreditCard,
    bg: "bg-purple-100",
    fg: "text-purple-600",
  },
  trial_ends: { icon: Clock, bg: "bg-amber-100", fg: "text-amber-600" },
  onboarding_started: {
    icon: Sparkles,
    bg: "bg-indigo-100",
    fg: "text-indigo-600",
  },
  onboarding_completed: {
    icon: Sparkles,
    bg: "bg-indigo-100",
    fg: "text-indigo-600",
  },
  import_completed: { icon: Download, bg: "bg-cyan-100", fg: "text-cyan-600" },
  first_client: { icon: Users, bg: "bg-teal-100", fg: "text-teal-600" },
  first_project: { icon: FolderKanban, bg: "bg-teal-100", fg: "text-teal-600" },
  first_time_entry: {
    icon: TimerReset,
    bg: "bg-teal-100",
    fg: "text-teal-600",
  },
  first_invoice: {
    icon: FileText,
    bg: "bg-emerald-100",
    fg: "text-emerald-600",
  },
  two_factor_enabled: {
    icon: ShieldCheck,
    bg: "bg-green-100",
    fg: "text-green-600",
  },
  passkey_added: {
    icon: Fingerprint,
    bg: "bg-green-100",
    fg: "text-green-600",
  },
  calendar_connected: {
    icon: Calendar,
    bg: "bg-violet-100",
    fg: "text-violet-600",
  },
  flagged: { icon: AlertTriangle, bg: "bg-red-100", fg: "text-red-600" },
  login: { icon: LogIn, bg: "bg-gray-100", fg: "text-gray-500" },
  note: { icon: MessageSquare, bg: "bg-blue-100", fg: "text-blue-600" },
  admin_action: { icon: Settings, bg: "bg-amber-100", fg: "text-amber-600" },
};

type Translator = ReturnType<typeof useTranslations>;

function formatDateTime(date: Date | string, locale: string): string {
  return new Date(date).toLocaleString(toIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseUserAgent(ua: string | null, t: Translator): string {
  if (!ua) return t("activity.unknownDevice");
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return ua.slice(0, 40);
}

function eventTitle(
  event: Record<string, unknown> & { type: string },
  t: Translator,
): string {
  if (event.type === "admin_action") {
    const action = event.action as string | undefined;
    if (action) {
      return t.has(`activity.actions.${action}`)
        ? t(`activity.actions.${action}`)
        : action;
    }
    return t("activity.adminAction");
  }
  if (event.type === "note") return t("activity.noteAdded");
  if (event.type === "login") return t("activity.login");
  return (event.label as string | undefined) ?? event.type;
}

export function UserActivity({ userId, activeTab }: UserActivityProps) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const {
    data: timeline,
    refetch,
    isLoading,
  } = trpc.admin.getUserTimeline.useQuery(
    { userId, limit: 100 },
    { enabled: activeTab === "timeline" },
  );

  if (activeTab !== "timeline") return null;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {timeline ? t("activity.events", { count: timeline.length }) : ""}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          {t("activity.refresh")}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      ) : timeline?.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <History className="mx-auto mb-2 h-10 w-10 opacity-50" />
          <p>{t("activity.empty")}</p>
        </div>
      ) : (
        <ol className="relative space-y-3 pl-2">
          {/* vertical rail */}
          <div
            className="absolute left-[19px] top-2 bottom-2 w-px bg-gray-200"
            aria-hidden="true"
          />
          {timeline?.map((event) => {
            const meta = ICONS[event.type] ?? ICONS.admin_action;
            const Icon = meta.icon;
            return (
              <li
                key={event.id}
                className="relative flex items-start gap-3 rounded-lg border border-gray-100 bg-white p-3 hover:border-gray-200"
              >
                <div
                  className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${meta.bg}`}
                >
                  <Icon className={`h-4 w-4 ${meta.fg}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium text-gray-900">
                      {eventTitle(event, t)}
                    </p>
                    <span className="shrink-0 text-xs text-gray-400">
                      {formatDateTime(event.createdAt, locale)}
                    </span>
                  </div>

                  {event.type === "note" && (
                    <div className="mt-1 text-sm text-gray-600">
                      {(event as { isImportant?: boolean | null })
                        .isImportant && (
                        <span className="mr-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          {t("activity.important")}
                        </span>
                      )}
                      <span>{(event as { content: string }).content}</span>
                    </div>
                  )}

                  {event.type === "login" && (
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      {"ipAddress" in event && event.ipAddress && (
                        <span>
                          {t("activity.ip", { ip: event.ipAddress as string })}
                        </span>
                      )}
                      {"userAgent" in event && (
                        <span>
                          {parseUserAgent(event.userAgent as string | null, t)}
                        </span>
                      )}
                    </div>
                  )}

                  {event.type === "flagged" &&
                    (event as { reason?: string | null }).reason && (
                      <p className="mt-1 text-sm text-red-700">
                        {t("activity.reason", {
                          reason: (event as { reason: string }).reason,
                        })}
                      </p>
                    )}

                  {event.type === "admin_action" &&
                    (() => {
                      const details = (event as { details: unknown }).details;
                      if (
                        typeof details === "object" &&
                        details !== null &&
                        Object.keys(details as Record<string, unknown>).length >
                          0
                      ) {
                        return (
                          <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 font-mono text-xs text-gray-600">
                            {JSON.stringify(details, null, 2)}
                          </pre>
                        );
                      }
                      return null;
                    })()}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
