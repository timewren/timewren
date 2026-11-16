import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Brain,
  Cloud,
  Database,
  Download,
  FileText,
  Fingerprint,
  KeyRound,
  Puzzle,
  RefreshCw,
  Settings,
  Shield,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AiSettings } from "@/components/settings/AiSettings";
import { BackupSettings } from "@/components/settings/BackupSettings";
import { ExportSettings } from "@/components/settings/ExportSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { IdentitySettings } from "@/components/settings/IdentitySettings";
import { IntegrationSettings } from "@/components/settings/IntegrationSettings";
import { InvoiceSettings } from "@/components/settings/InvoiceSettings";
import { LicenseSettings } from "@/components/settings/LicenseSettings";
import { PrivacySettings } from "@/components/settings/PrivacySettings";
import { SyncSettings } from "@/components/settings/SyncSettings";
import { TrackingSettings } from "@/components/settings/TrackingSettings";
import { UpdateSettings } from "@/components/settings/UpdateSettings";
import { FeedbackButton } from "@/components/ui/FeedbackButton";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

type TabId =
  | "general"
  | "tracking"
  | "identity"
  | "ai"
  | "integrations"
  | "invoicing"
  | "privacy"
  | "export"
  | "backup"
  | "sync"
  | "license"
  | "updates";

function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("general");

  const TABS: { id: TabId; label: string; icon: typeof Settings }[] = [
    { id: "general", label: t("settings.general"), icon: Settings },
    { id: "tracking", label: t("settings.tracking"), icon: Activity },
    { id: "identity", label: t("identity.title"), icon: Fingerprint },
    { id: "ai", label: t("settings.ai"), icon: Brain },
    { id: "integrations", label: t("settings.integrations"), icon: Puzzle },
    { id: "invoicing", label: t("settings.invoicing"), icon: FileText },
    { id: "privacy", label: t("privacy.title"), icon: Shield },
    { id: "export", label: t("settings.export"), icon: Download },
    { id: "backup", label: t("settings.backupTab"), icon: Database },
    { id: "sync", label: t("settings.sync"), icon: Cloud },
    { id: "license", label: t("settings.license"), icon: KeyRound },
    { id: "updates", label: t("updates.title"), icon: RefreshCw },
  ];

  return (
    <div className="mx-auto flex max-w-4xl gap-8">
      {/* Vertical tab navigation */}
      <nav className="sticky top-0 flex w-44 shrink-0 flex-col gap-1 pt-1">
        <h1 className="mb-4 text-lg font-bold text-(--color-text)">
          {t("settings.title")}
        </h1>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left ${
              activeTab === id
                ? "bg-(--color-accent)/10 text-(--color-accent)"
                : "text-(--color-text-muted) hover:bg-(--color-border)/50 hover:text-(--color-text)"
            }`}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </button>
        ))}

        <div className="mt-3 border-t border-(--color-border) pt-3">
          <FeedbackButton />
        </div>
      </nav>

      {/* Settings content */}
      <div className="min-w-0 flex-1 pb-12 pt-1">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-(--color-text)">
            {TABS.find((tab) => tab.id === activeTab)?.label}
          </h2>
        </div>

        {activeTab === "general" && <GeneralSettings />}
        {activeTab === "tracking" && <TrackingSettings />}
        {activeTab === "identity" && <IdentitySettings />}
        {activeTab === "ai" && <AiSettings />}
        {activeTab === "integrations" && <IntegrationSettings />}
        {activeTab === "invoicing" && <InvoiceSettings />}
        {activeTab === "privacy" && <PrivacySettings />}
        {activeTab === "export" && <ExportSettings />}
        {activeTab === "backup" && <BackupSettings />}
        {activeTab === "sync" && <SyncSettings />}
        {activeTab === "license" && <LicenseSettings />}
        {activeTab === "updates" && <UpdateSettings />}
      </div>
    </div>
  );
}
