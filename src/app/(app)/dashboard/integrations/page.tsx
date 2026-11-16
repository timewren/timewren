"use client";

import { AlertCircle, ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";

function IntegrationsPageContent() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("integrations.index");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <PageHeader
        title={t("title")}
        description={t("description", { brand: brand.name })}
        helpTopicId="integrations"
      />

      {/* Integrationssundhed (#169) */}
      <Link
        href="/dashboard/integrations/health"
        className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/60"
      >
        <span className="font-medium text-gray-900 dark:text-white">
          {t("healthLink")}
        </span>
        <span className="shrink-0 text-brand-600 dark:text-brand-400">
          {t("healthCta")}
        </span>
      </Link>

      {/* Import Data Section */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
          {t("importData")}
        </h2>

        {/* Time Tracking Importers */}
        <div className="mb-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300">
              {t("timeTracking")}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ImportCard
              name="Clockify"
              description={t("card.clockify")}
              href="/dashboard/integrations/import-clockify"
            />
            <ImportCard
              name="Toggl Track"
              description={t("card.toggl")}
              href="/dashboard/integrations/import-toggl"
            />
            <ImportCard
              name="Harvest"
              description={t("card.harvest")}
              href="/dashboard/integrations/import-harvest"
            />
            <ImportCard
              name="Effihub"
              description={t("card.effihub")}
              href="/dashboard/integrations/import-effihub"
            />
            <ImportCard
              name="TimeOps"
              description={t("card.timeops")}
              href="/dashboard/integrations/import-timeops"
              badge="API"
            />
          </div>
        </div>

        {/* Task Importers */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
              {t("tasks")}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ImportCard
              name="Trello"
              description={t("card.trello")}
              href="/dashboard/integrations/import-trello"
            />
            <ImportCard
              name="Todoist"
              description={t("card.todoist")}
              href="/dashboard/integrations/import-todoist"
            />
          </div>
        </div>
      </div>

      {/* Accounting Integrations */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
          {t("accounting")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/dashboard/settings/integrations"
            className="flex items-start justify-between rounded-lg border border-gray-200 p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-gray-800 dark:hover:border-brand-600 dark:hover:bg-tt-gran-lys"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                  Billy's Billing
                </h4>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900 dark:text-green-300">
                  {t("available")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("configure", { name: "Billy" })}
              </p>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          </Link>
          <Link
            href="/dashboard/settings/integrations"
            className="flex items-start justify-between rounded-lg border border-gray-200 p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-gray-800 dark:hover:border-brand-600 dark:hover:bg-tt-gran-lys"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                  Dinero
                </h4>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900 dark:text-green-300">
                  {t("available")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("configure", { name: "Dinero" })}
              </p>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          </Link>
          <Link
            href="/dashboard/settings/integrations"
            className="flex items-start justify-between rounded-lg border border-gray-200 p-4 transition-colors hover:border-purple-300 hover:bg-purple-50/50 dark:border-gray-800 dark:hover:border-purple-600 dark:hover:bg-purple-950/30"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                  e-conomic
                </h4>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900 dark:text-green-300">
                  {t("available")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("configure", { name: "e-conomic" })}
              </p>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          </Link>
        </div>
        <div className="mt-3">
          <Link
            href="/dashboard/integrations/sync"
            className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-gray-700 dark:hover:border-brand-600 dark:hover:bg-tt-gran-lys"
          >
            <RefreshCw className="h-4 w-4 text-gray-400" />
            <div className="flex-1">
              <h4 className="font-medium text-gray-900 dark:text-gray-100">
                {t("syncTitle")}
              </h4>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("syncDesc")}
              </p>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          </Link>
        </div>
      </div>

      {/* Security Notice */}
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-6">
        <div className="flex items-start gap-4">
          <AlertCircle className="h-6 w-6 shrink-0 text-tt-graa" />
          <div>
            <h3 className="font-semibold text-gray-900">
              {t("securityTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {t("securityBody", { brand: brand.name })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <ModuleGuard module="integrations">
      <IntegrationsPageContent />
    </ModuleGuard>
  );
}

function ImportCard({
  name,
  description,
  href,
  badge,
}: {
  name: string;
  description: string;
  href: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start justify-between rounded-lg border border-gray-200 p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-gray-800 dark:hover:border-brand-600 dark:hover:bg-tt-gran-lys"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-gray-900 dark:text-gray-100">
            {name}
          </h4>
          {badge && (
            <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
    </Link>
  );
}
