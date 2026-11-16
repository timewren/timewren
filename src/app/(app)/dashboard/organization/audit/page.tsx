"use client";

import { ClipboardList, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import {
  AuditDiffView,
  type AuditT,
  auditBadgeClass,
  auditDetailText,
  auditDiffOf,
  auditLabel,
} from "@/components/enterprise/AuditEntryList";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  AUDIT_ACTION_CATEGORY,
  AUDIT_ACTION_LABELS,
  type OrgAuditAction,
  type OrgAuditCategory,
} from "@/lib/org-audit";
import { trpc } from "@/providers/trpc-provider";

const CATEGORY_KEYS: Record<OrgAuditCategory, true> = {
  members: true,
  settings: true,
  time: true,
  billing: true,
  absence: true,
  employees: true,
  timesheets: true,
  security: true,
};

function relativeTime(
  date: Date | string,
  t: (key: string, values?: Record<string, number>) => string,
  intlLocale: string,
): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMin < 60) {
    return t("minutesAgo", { count: diffMin });
  }
  if (diffHours < 24) {
    return t("hoursAgo", { count: diffHours });
  }
  return new Date(date).toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AuditLogPage() {
  const t = useTranslations("organization.audit");
  const ta = useTranslations("enterpriseAudit") as unknown as AuditT;
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const intlLocale = toIntlLocale(useLocale());
  const [offset, setOffset] = useState(0);
  // Kategori (#466) indsnævrer listen af handlinger; handling = én action
  const [filterCategory, setFilterCategory] = useState<OrgAuditCategory | "">(
    "",
  );
  const [filterAction, setFilterAction] = useState("");

  const { data, isLoading, error } = trpc.orgAudit.getOrgAuditLog.useQuery({
    limit: 25,
    offset,
    action: filterAction || undefined,
    category: filterCategory || undefined,
  });

  const actionOptions = (
    Object.keys(AUDIT_ACTION_LABELS) as OrgAuditAction[]
  ).filter(
    (a) => !filterCategory || AUDIT_ACTION_CATEGORY[a] === filterCategory,
  );

  const [allLogs, setAllLogs] = useState<typeof data>([]);

  // When new data arrives, append to existing
  useEffect(() => {
    if (data && data.length > 0) {
      setAllLogs((prev) => (offset === 0 ? data : [...(prev || []), ...data]));
    }
  }, [data, offset]);

  // When filter changes, reset
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtrene er udløsere: listen nulstilles, når et filter skifter
  useEffect(() => {
    setAllLogs([]);
    setOffset(0);
  }, [filterAction, filterCategory]);

  if (error && error.data?.code === "FORBIDDEN") {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-12 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-red-400" />
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("noAccess")}
          </h3>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t("noAccessBody")}
          </p>
          <Link
            href="/dashboard/organization"
            className="mt-6 inline-flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t("back")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/dashboard/organization"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {t("back")}
      </Link>

      <PageHeader title={t("title")} description={t("description")} />

      {/* Filter: kategori + handling (#466) */}
      <div className="grid gap-3 rounded-xl border border-gray-200/80 bg-white p-4 sm:grid-cols-2 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <label
            htmlFor="audit-category"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("category")}
          </label>
          <select
            id="audit-category"
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value as OrgAuditCategory | "");
              setFilterAction("");
              setOffset(0);
            }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">{t("allCategories")}</option>
            {(Object.keys(CATEGORY_KEYS) as OrgAuditCategory[]).map((key) => (
              <option key={key} value={key}>
                {ta(`categories.${key}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="audit-action"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("action")}
          </label>
          <select
            id="audit-action"
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value);
              setOffset(0);
            }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">{t("allActions")}</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {auditLabel(a, ta)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900">
        {isLoading ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {Array.from({ length: 5 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
              <div key={i} className="flex items-center gap-4 p-4">
                <div className="h-6 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-6 w-6 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
                <div className="h-6 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-6 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-6 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              </div>
            ))}
          </div>
        ) : !allLogs || allLogs.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">
              {t("emptyTitle")}
            </h3>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          <>
            {/* Header row */}
            <div className="hidden sm:grid sm:grid-cols-[120px_1fr_140px_1fr] gap-4 border-b border-gray-200 dark:border-gray-700 px-4 py-3 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              <span>{t("colTime")}</span>
              <span>{t("colWho")}</span>
              <span>{t("colAction")}</span>
              <span>{t("colDetail")}</span>
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {allLogs.map((log) => {
                const diff = auditDiffOf(log);
                return (
                  <div
                    key={log.id}
                    className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[120px_1fr_140px_1fr] sm:items-center sm:gap-4"
                  >
                    {/* Tidspunkt */}
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {relativeTime(log.createdAt, t, intlLocale)}
                    </span>

                    {/* Hvem */}
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        name={log.actor?.name}
                        image={log.actor?.image}
                        size="xs"
                      />
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                        {log.actor?.name || log.actorLabel || t("unknown")}
                      </span>
                    </div>

                    {/* Handling */}
                    <span
                      className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${auditBadgeClass(log.action)}`}
                      title={new Date(log.createdAt).toLocaleString(intlLocale)}
                    >
                      {auditLabel(log.action, ta)}
                    </span>

                    {/* Detalje + evt. før/efter-diff */}
                    <div className="min-w-0 text-sm text-gray-600 dark:text-gray-400">
                      <span className="block truncate">
                        {auditDetailText(log, ta, intlLocale, brand.name)}
                      </span>
                      {diff && <AuditDiffView diff={diff} t={ta} />}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more */}
            {data && data.length === 25 && (
              <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 text-center">
                <button
                  type="button"
                  onClick={() => setOffset((prev) => prev + 25)}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  {t("loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
