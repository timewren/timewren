"use client";

import { Activity, BarChart3, FileText, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { EmailActivityTab } from "./_components/EmailActivityTab";
import { EmailAnalyticsTab } from "./_components/EmailAnalyticsTab";
import { EmailIntegrationTab } from "./_components/EmailIntegrationTab";
import { EmailTemplatesTab } from "./_components/EmailTemplatesTab";

const TABS = [
  { key: "skabeloner", labelKey: "tabTemplates", icon: FileText },
  { key: "integration", labelKey: "tabIntegration", icon: Mail },
  { key: "aktivitet", labelKey: "tabActivity", icon: Activity },
  { key: "analytik", labelKey: "tabAnalytics", icon: BarChart3 },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function EmailPageContent() {
  const t = useTranslations("settingsEmail");
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isEnabled, isAdmin } = useFeatureFlags();

  const currentTab = (searchParams.get("tab") as TabKey) || "skabeloner";

  const visibleTabs = TABS.filter(
    (tab) =>
      tab.key === "skabeloner" ||
      (tab.key === "aktivitet" && isAdmin) ||
      isEnabled("emailToTask"),
  );

  const setTab = (tab: TabKey) => {
    router.push(`/dashboard/settings/email?tab=${tab}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header */}
      <PageHeader title={t("title")} description={t("description")} />

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-6" aria-label={t("tabsLabel")}>
          {visibleTabs.map((tab) => {
            const isActive = currentTab === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTab(tab.key)}
                className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {currentTab === "skabeloner" && <EmailTemplatesTab />}
      {currentTab === "integration" && isEnabled("emailToTask") && (
        <EmailIntegrationTab />
      )}
      {currentTab === "aktivitet" && isAdmin && <EmailActivityTab />}
      {currentTab === "analytik" && isEnabled("emailToTask") && (
        <EmailAnalyticsTab />
      )}
    </div>
  );
}

export default function EmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <InlineSpinner className="h-8 w-8" />
        </div>
      }
    >
      <EmailPageContent />
    </Suspense>
  );
}
