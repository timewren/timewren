"use client";

import {
  BookOpen,
  CreditCard,
  LineChart,
  Receipt,
  RefreshCw,
  Wallet,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshIndicator } from "@/components/admin";
import { RevenueChart } from "@/components/admin/RevenueChart";
import { RevenueOverview } from "@/components/admin/RevenueOverview";
import { SubscriptionTable } from "@/components/admin/SubscriptionTable";
import { WebhookLogs } from "@/components/admin/WebhookLogs";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

type Tab =
  | "overblik"
  | "abonnementer"
  | "periodisering"
  | "prognoser"
  | "bogfoering"
  | "webhooks";

const tabs: {
  key: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "overblik", label: "Overblik", icon: Wallet },
  { key: "abonnementer", label: "Abonnementer", icon: CreditCard },
  { key: "periodisering", label: "Periodisering", icon: Receipt },
  { key: "prognoser", label: "Prognoser", icon: LineChart },
  { key: "bogfoering", label: "Bogfoering", icon: BookOpen },
  { key: "webhooks", label: "Webhooks", icon: Webhook },
];

export default function FinancePage() {
  const [activeTab, setActiveTab] = useState<Tab>("overblik");
  const utils = trpc.useUtils();

  const { data: overview, isLoading: loadingOverview } =
    trpc.admin.getFinanceOverview.useQuery(undefined, {
      enabled: activeTab === "overblik",
    });
  const { data: aluntaRevenue } = trpc.admin.getAluntaRevenue.useQuery(
    undefined,
    { enabled: activeTab === "overblik" },
  );
  const { data: mrrHistory, isLoading: loadingMrrHistory } =
    trpc.admin.getMrrHistory.useQuery(
      { monthsBack: 12 },
      { enabled: activeTab === "overblik" },
    );

  const [isSyncing, setIsSyncing] = useState(false);
  const syncMutation = trpc.admin.syncFromAlunta.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Synkroniseret fra Alunta: ${result.synced} opdateret, ${result.created} oprettet, ${result.skipped} sprunget over`,
      );
      if (result.errors.length > 0)
        toast.error(`${result.errors.length} fejl under synkronisering`);
      handleRefresh();
    },
    onError: (err) => toast.error(`Synkronisering fejlede: ${err.message}`),
    onSettled: () => setIsSyncing(false),
  });

  const handleRefresh = () => {
    utils.admin.getFinanceOverview.invalidate();
    utils.admin.getMrrHistory.invalidate();
    utils.admin.getSubscriptionBreakdown.invalidate();
    utils.admin.getAccrualSchedule.invalidate();
    utils.admin.getRevenueForecasts.invalidate();
    utils.admin.getBookkeepingGuide.invalidate();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Finans</h1>
          <p className="text-sm text-gray-500">
            Finansielt overblik over SaaS-forretningen
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setIsSyncing(true);
              syncMutation.mutate();
            }}
            disabled={isSyncing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
            />
            {isSyncing ? "Synkroniserer..." : "Synk fra Alunta"}
          </button>
          <RefreshIndicator onRefresh={handleRefresh} />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-gray-900 shadow"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overblik" &&
        (loadingOverview ? (
          <div className="flex items-center justify-center py-12">
            <InlineSpinner className="h-8 w-8" />
          </div>
        ) : overview ? (
          <RevenueOverview
            overview={overview}
            aluntaRevenue={aluntaRevenue}
            mrrHistory={mrrHistory}
            loadingMrrHistory={loadingMrrHistory}
          />
        ) : null)}

      {activeTab === "abonnementer" && <SubscriptionTable />}
      {activeTab === "periodisering" && <RevenueChart type="accrual" />}
      {activeTab === "prognoser" && <RevenueChart type="forecasts" />}
      {activeTab === "bogfoering" && <RevenueChart type="bookkeeping" />}
      {activeTab === "webhooks" && <WebhookLogs />}
    </div>
  );
}
