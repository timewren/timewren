"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useModules } from "@/hooks/useModules";
import { trpc } from "@/providers/trpc-provider";

function timeAgo(
  date: Date | string,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("now");
  if (mins < 60) return t("minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("hours", { count: hours });
  const days = Math.floor(hours / 24);
  return t("days", { count: days });
}

/**
 * In-app-indbakke (E10, #468) — klokke i sidebaren for enterprise-brugere.
 * Ulæste tælles hvert 2. minut; listen hentes når panelet åbnes.
 */
export function InboxBell({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("feedback.inbox");
  const { isEnabled } = useModules();
  const enterprise = isEnabled("enterprise");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const { data: unread } = trpc.enterprise.inboxUnreadCount.useQuery(
    undefined,
    { enabled: enterprise, refetchInterval: 120_000, retry: false },
  );
  const { data: items } = trpc.enterprise.listInbox.useQuery(
    { limit: 20 },
    { enabled: enterprise && open, retry: false },
  );
  const markRead = trpc.enterprise.markInboxRead.useMutation({
    onSuccess: () => {
      utils.enterprise.inboxUnreadCount.invalidate();
      utils.enterprise.listInbox.invalidate();
    },
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!enterprise) return null;
  const count = unread ?? 0;

  return (
    <div ref={ref} className="relative px-4 pb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? t("titleUnread", { count }) : t("title")}
        aria-expanded={open}
        title={collapsed ? t("title") : undefined}
        className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${collapsed ? "justify-center" : "gap-3"}`}
      >
        <span className="relative">
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-tt-gran px-1 text-[10px] font-semibold text-tt-paa-gran">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </span>
        {!collapsed && <span>{t("title")}</span>}
      </button>

      {open && (
        <div className="absolute bottom-full left-4 z-50 mb-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("title")}
            </span>
            {count > 0 && (
              <button
                type="button"
                onClick={() => markRead.mutate({})}
                className="flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-400"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t("markAll")}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items && items.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                {t("empty")}
              </li>
            )}
            {(items ?? []).map((n) => (
              <li
                key={n.id}
                className={`border-b border-gray-100 last:border-0 dark:border-gray-800 ${n.readAt ? "" : "bg-brand-50/60 dark:bg-tt-gran-lys"}`}
              >
                <Link
                  href={n.url ?? "/dashboard"}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate({ id: n.id });
                    setOpen(false);
                  }}
                  className="block px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {n.title}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {timeAgo(n.createdAt, t)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
                    {n.body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
