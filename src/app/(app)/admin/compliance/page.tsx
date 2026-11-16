"use client";

import { Activity, Shield, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ActivityView } from "@/components/admin/views/ActivityView";
import { GdprView } from "@/components/admin/views/GdprView";
import { SecurityView } from "@/components/admin/views/SecurityView";

type Tab = "security" | "gdpr" | "activity";

const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "security", label: "Sikkerhed", icon: Shield },
  { key: "gdpr", label: "GDPR", icon: ShieldCheck },
  { key: "activity", label: "Aktivitetslog", icon: Activity },
];

const descriptions: Record<Tab, string> = {
  security:
    "Login-aktivitet, sikkerhedshandlinger og flag-status (seneste 14 dage)",
  gdpr: "Data export og sletning. GDPR Art. 12: maks 30 dage til at svare.",
  activity: "Alle admin-handlinger logges for audit trail",
};

export default function CompliancePage() {
  const [activeTab, setActiveTab] = useState<Tab>("security");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Compliance</h1>
        <p className="mt-1 text-sm text-gray-500">{descriptions[activeTab]}</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-4 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "border-brand-500 text-brand-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "security" && <SecurityView />}
      {activeTab === "gdpr" && <GdprView />}
      {activeTab === "activity" && <ActivityView />}
    </div>
  );
}
