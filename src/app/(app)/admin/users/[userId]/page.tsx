"use client";

import {
  ChevronLeft,
  Clock,
  CreditCard,
  FileText,
  FolderKanban,
  History,
  Puzzle,
  ShieldCheck,
  StickyNote,
  Timer,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { UserActions } from "@/components/admin/UserActions";
import { UserActivity } from "@/components/admin/UserActivity";
import { UserBilling } from "@/components/admin/UserBilling";
import { UserData } from "@/components/admin/UserData";
import { UserHeader } from "@/components/admin/UserHeader";
import { UserIntegrations } from "@/components/admin/UserIntegrations";
import { UserProfile } from "@/components/admin/UserProfile";
import { UserSecurity } from "@/components/admin/UserSecurity";
import { UserTimerEvents } from "@/components/admin/UserTimerEvents";
import { trpc } from "@/providers/trpc-provider";

type Tab =
  | "profile"
  | "security"
  | "integrations"
  | "clients"
  | "projects"
  | "time"
  | "invoices"
  | "notes"
  | "timeline"
  | "timerlog"
  | "billing";

export default function AdminUserDetailPage() {
  const t = useTranslations("adminUsers");
  const params = useParams();
  const userId = params.userId as string;
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  // Dybt link fra stabilitetsvagtens alarmer: ?tab=timerlog
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "timerlog") setActiveTab("timerlog");
  }, []);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBanModal, setShowBanModal] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);

  const { data: currentUser } = trpc.user.getProfile.useQuery();
  const isAdmin = currentUser?.role === "admin";

  const { data: user, isLoading: userLoading } =
    trpc.admin.getUserForSupport.useQuery({ userId });

  const tabs = [
    ...(isAdmin
      ? [
          {
            id: "profile" as const,
            label: t("detail.tabs.profile"),
            icon: User,
          },
          {
            id: "security" as const,
            label: t("detail.tabs.security"),
            icon: ShieldCheck,
          },
          {
            id: "integrations" as const,
            label: t("detail.tabs.integrations"),
            icon: Puzzle,
          },
        ]
      : []),
    {
      id: "clients" as const,
      label: t("detail.tabs.clients"),
      icon: Users,
      count: user?.stats?.clients,
    },
    {
      id: "projects" as const,
      label: t("detail.tabs.projects"),
      icon: FolderKanban,
      count: user?.stats?.projects,
    },
    {
      id: "time" as const,
      label: t("detail.tabs.time"),
      icon: Clock,
      count: user?.stats?.timeEntries,
    },
    {
      id: "invoices" as const,
      label: t("detail.tabs.invoices"),
      icon: FileText,
      count: user?.stats?.invoices,
    },
    {
      id: "notes" as const,
      label: t("detail.tabs.notes"),
      icon: StickyNote,
      count: user?.stats?.notes,
    },
    {
      id: "timeline" as const,
      label: t("detail.tabs.timeline"),
      icon: History,
    },
    ...(isAdmin
      ? [
          {
            id: "timerlog" as const,
            label: t("detail.tabs.timerlog"),
            icon: Timer,
          },
          {
            id: "billing" as const,
            label: t("detail.tabs.billing"),
            icon: CreditCard,
          },
        ]
      : []),
  ];

  if (userLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-32 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          {t("detail.notFoundTitle")}
        </h2>
        <p className="text-gray-500 mb-4">{t("detail.notFoundBody")}</p>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-brand-600 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" /> {t("detail.backToList")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <UserHeader
        user={user}
        userId={userId}
        isAdmin={isAdmin}
        onShowFlag={() => setShowFlagModal(true)}
        onShowVerify={() => setShowVerifyModal(true)}
        onShowBan={() => setShowBanModal(true)}
        onShowDelete={() => setShowDeleteModal(true)}
      />

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav
          className="flex gap-4 overflow-x-auto"
          aria-label={t("detail.tabsLabel")}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-brand-500 text-brand-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "profile" && isAdmin ? (
        <UserProfile userId={userId} activeTab={activeTab} />
      ) : activeTab === "security" && isAdmin ? (
        <UserSecurity userId={userId} activeTab={activeTab} />
      ) : activeTab === "integrations" && isAdmin ? (
        <UserIntegrations userId={userId} activeTab={activeTab} />
      ) : activeTab === "timerlog" && isAdmin ? (
        <UserTimerEvents userId={userId} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <UserData userId={userId} activeTab={activeTab} />
          <UserActivity userId={userId} activeTab={activeTab} />
          <UserBilling
            userId={userId}
            activeTab={activeTab}
            isAdmin={isAdmin}
          />
        </div>
      )}

      <UserActions
        userId={userId}
        userName={user.name || t("detail.unknown")}
        isAdmin={isAdmin}
        showDeleteModal={showDeleteModal}
        showFlagModal={showFlagModal}
        showVerifyModal={showVerifyModal}
        showBanModal={showBanModal}
        onCloseDelete={() => setShowDeleteModal(false)}
        onCloseFlag={() => setShowFlagModal(false)}
        onCloseVerify={() => setShowVerifyModal(false)}
        onCloseBan={() => setShowBanModal(false)}
      />
    </div>
  );
}
