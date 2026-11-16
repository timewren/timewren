"use client";

import {
  ArrowRight,
  Calculator,
  Filter as FunnelIcon,
  Globe,
  LayoutDashboard,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { OnboardingFunnelView } from "@/components/admin/views/OnboardingFunnelView";
import { ScenariosView } from "@/components/admin/views/ScenariosView";
import { trpc } from "@/providers/trpc-provider";

type Tab = "overview" | "funnel" | "scenarios";

const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overblik", icon: LayoutDashboard },
  { key: "funnel", label: "Onboarding funnel", icon: FunnelIcon },
  { key: "scenarios", label: "Scenarios", icon: Calculator },
];

const STAGE_COLORS: Record<string, { bg: string; bar: string; text: string }> =
  {
    brand_new: { bg: "bg-blue-50", bar: "bg-blue-400", text: "text-blue-900" },
    onboarding: {
      bg: "bg-indigo-50",
      bar: "bg-indigo-400",
      text: "text-indigo-900",
    },
    trial_idle: {
      bg: "bg-amber-50",
      bar: "bg-amber-400",
      text: "text-amber-900",
    },
    trial_active: {
      bg: "bg-cyan-50",
      bar: "bg-cyan-400",
      text: "text-cyan-900",
    },
    paying: { bg: "bg-green-50", bar: "bg-green-500", text: "text-green-900" },
    dormant: { bg: "bg-gray-100", bar: "bg-gray-400", text: "text-gray-800" },
    lapsed: { bg: "bg-red-50", bar: "bg-red-400", text: "text-red-900" },
  };

function AttributionSection() {
  const { data } = trpc.admin.getAttributionBreakdown.useQuery({
    daysBack: 90,
  });
  if (!data) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">
            Attribution — hvor kommer brugerne fra (90 dage)
          </h2>
        </div>
        <span className="text-xs text-gray-500">
          {data.totalSignups} signups
        </span>
      </div>
      <div className="p-5">
        {data.sources.length === 0 ? (
          <p className="text-sm text-gray-500">Ingen attribution endnu.</p>
        ) : (
          <div className="space-y-3">
            {data.sources.map((s) => (
              <div key={s.source}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-gray-900">{s.source}</span>
                  <span className="text-xs text-gray-500">
                    {s.count} · {s.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${s.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {data.topCampaigns.length > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
              Top kampagner
            </h3>
            <ul className="space-y-1 text-sm">
              {data.topCampaigns.map((c) => (
                <li
                  key={c.campaign}
                  className="flex justify-between text-gray-700"
                >
                  <span className="truncate">{c.campaign}</span>
                  <span className="shrink-0 text-gray-500">{c.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function JourneySection() {
  const { data } = trpc.admin.getJourneyStages.useQuery();
  if (!data) return null;

  const maxCount = Math.max(...data.stages.map((s) => s.count), 1);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">
            Kunderejse — hvor er brugerne lige nu
          </h2>
        </div>
        <span className="text-xs text-gray-500">{data.total} brugere</span>
      </div>
      <div className="p-5">
        <div className="space-y-3">
          {data.stages.map((stage) => {
            const colors = STAGE_COLORS[stage.key] ?? STAGE_COLORS.brand_new;
            const widthPct = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
            return (
              <div key={stage.key}>
                <div className="flex items-baseline justify-between text-sm">
                  <div>
                    <span className={`font-medium ${colors.text}`}>
                      {stage.label}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {stage.description}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-medium text-gray-900">
                    {stage.count}
                  </span>
                </div>
                <div
                  className={`mt-1 h-2 overflow-hidden rounded-full ${colors.bg}`}
                >
                  <div
                    className={`h-full rounded-full ${colors.bar}`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 space-y-4 border-t border-gray-100 pt-5">
          {data.stages
            .filter((s) => s.count > 0)
            .map((stage) => {
              const colors = STAGE_COLORS[stage.key] ?? STAGE_COLORS.brand_new;
              return (
                <div key={`drill-${stage.key}`}>
                  <h3
                    className={`mb-2 text-xs font-medium uppercase tracking-wider ${colors.text}`}
                  >
                    {stage.label} ({stage.count})
                  </h3>
                  <ul className="divide-y divide-gray-50 text-sm">
                    {stage.users.slice(0, 5).map((u) => (
                      <li
                        key={u.userId}
                        className="flex items-center justify-between py-1.5"
                      >
                        <Link
                          href={`/admin/users/${u.userId}`}
                          className="min-w-0 flex-1 truncate text-brand-600 hover:underline"
                        >
                          {u.userName || u.userEmail || u.userId.slice(0, 8)}
                        </Link>
                        <span className="shrink-0 text-xs text-gray-400">
                          {new Date(u.createdAt).toLocaleDateString("da-DK", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </li>
                    ))}
                    {stage.count > 5 && (
                      <li className="py-1.5 text-xs text-gray-400">
                        + {stage.count - 5} flere…
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export default function GrowthPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Growth</h1>
        <p className="mt-1 text-sm text-gray-500">
          Attribution, kunderejse, onboarding funnel og revenue-scenarios
        </p>
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

      {activeTab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <JourneySection />
          <AttributionSection />
        </div>
      )}
      {activeTab === "funnel" && <OnboardingFunnelView />}
      {activeTab === "scenarios" && <ScenariosView />}

      {activeTab === "overview" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/admin/users"
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 text-sm hover:border-brand-300 hover:bg-brand-50/30"
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              <span className="text-gray-900">Brugerliste</span>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-400" />
          </Link>
          <Link
            href="/admin/analytics"
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 text-sm hover:border-brand-300 hover:bg-brand-50/30"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gray-500" />
              <span className="text-gray-900">Detaljeret analyse</span>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-400" />
          </Link>
          <Link
            href="/admin/finance"
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 text-sm hover:border-brand-300 hover:bg-brand-50/30"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gray-500" />
              <span className="text-gray-900">Økonomi</span>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-400" />
          </Link>
        </div>
      )}
    </div>
  );
}
