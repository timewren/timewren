"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Crown,
  Globe,
  HeadphonesIcon,
  Mail,
  Map as MapIcon,
  Megaphone,
  Server,
  Settings,
  Shield,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

const adminNavItems = [
  { href: "/dashboard/admin", labelKey: "legacy.tabs.overview", icon: Shield },
  { href: "/dashboard/admin/users", labelKey: "nav.users", icon: Users },
  {
    href: "/dashboard/admin/activity",
    labelKey: "nav.activity",
    icon: Activity,
  },
  {
    href: "/dashboard/admin/monitoring",
    labelKey: "nav.monitoring",
    icon: Server,
  },
  {
    href: "/dashboard/admin/email-forwarding",
    labelKey: "legacy.tabs.email",
    icon: Mail,
  },
  {
    href: "/dashboard/admin/analytics",
    labelKey: "legacy.tabs.analytics",
    icon: BarChart3,
  },
  {
    href: "/dashboard/admin/finance",
    labelKey: "legacy.tabs.finance",
    icon: Wallet,
  },
  {
    href: "/dashboard/admin/analytics/traffic",
    labelKey: "legacy.tabs.traffic",
    icon: Globe,
  },
  {
    href: "/dashboard/admin/broadcasts",
    labelKey: "nav.broadcasts",
    icon: Megaphone,
  },
  {
    href: "/dashboard/admin/beta-signups",
    labelKey: "legacy.tabs.betaSignups",
    icon: UserPlus,
  },
  { href: "/dashboard/admin/roadmap", labelKey: "nav.roadmap", icon: MapIcon },
  {
    href: "/dashboard/admin/settings",
    labelKey: "nav.settings",
    icon: Settings,
    adminOnly: true,
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("adminShell");
  const router = useRouter();
  const pathname = usePathname();
  const { data: userProfile, isLoading } = trpc.user.getProfile.useQuery();

  // Get user role - default to 'user' if not set
  const userRole = userProfile?.role || "user";
  const isAdmin = userRole === "admin";
  const isSupporter = userRole === "supporter";
  const hasAccess = isAdmin || isSupporter;

  // Redirect non-admins/supporters
  useEffect(() => {
    if (!isLoading && userProfile && !hasAccess) {
      router.push("/dashboard");
    }
  }, [userProfile, isLoading, router, hasAccess]);

  // Show loading while checking
  if (isLoading) {
    return <LoadingScreen message={t("verifying")} showTip={false} />;
  }

  // Don't render if not admin/supporter
  if (!hasAccess) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Admin warning banner */}
      <div
        className={`rounded-lg border p-4 ${
          isAdmin
            ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-brand-200 bg-brand-50 dark:border-brand-600 dark:bg-tt-gran-lys"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              isAdmin
                ? "bg-amber-100 dark:bg-amber-900/50"
                : "bg-brand-100 dark:bg-tt-gran-lys"
            }`}
          >
            {isAdmin ? (
              <Crown
                className={`h-5 w-5 ${
                  isAdmin
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-brand-600 dark:text-brand-400"
                }`}
              />
            ) : (
              <HeadphonesIcon className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            )}
          </div>
          <div className="flex-1">
            <h3
              className={`font-semibold ${
                isAdmin
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-brand-800 dark:text-brand-200"
              }`}
            >
              {isAdmin ? t("legacy.adminPanel") : t("legacy.supporterPanel")}
            </h3>
            <p
              className={`mt-1 text-sm ${
                isAdmin
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-brand-700 dark:text-brand-300"
              }`}
            >
              {isAdmin ? t("legacy.adminDesc") : t("legacy.supporterDesc")}
            </p>
          </div>
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              isAdmin
                ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300"
                : "bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            {t("legacy.auditActive")}
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-4 overflow-x-auto">
          {adminNavItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard/admin" &&
                pathname.startsWith(item.href) &&
                // Don't highlight "Analytics" when on "Trafik" sub-page
                !(
                  item.href === "/dashboard/admin/analytics" &&
                  pathname.startsWith("/dashboard/admin/analytics/traffic")
                ));

            // Admin-only pages
            if ("adminOnly" in item && item.adminOnly && !isAdmin) {
              return null;
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-brand-500 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
