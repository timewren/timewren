"use client";

import { LogOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { LeveretAfTimeTrack } from "@/components/LeveretAfTimeTrack";
import { getPortalPath, useCustomDomain } from "@/hooks/useCustomDomain";
import { toIntlLocale } from "@/i18n/format-locale";
import type { DemoCurrency } from "@/lib/demo/demo-mode";
import { clearPortalSessions } from "@/lib/portal/session-key";
import { trpc } from "@/providers/trpc-provider";

export type PortalNavKey =
  | "overview"
  | "invoices"
  | "projects"
  | "time"
  | "prepaid"
  | "time-report"
  | "approvals";

export interface PortalPermissions {
  canViewInvoices: boolean | null;
  canViewProjects: boolean | null;
  canViewTimeEntries: boolean | null;
  canViewPrepaid: boolean | null;
  canApproveTime: boolean | null;
}

export interface PortalBranding {
  brandName?: string | null;
  logoUrl?: string | null;
  footerText?: string | null;
}

interface PortalShellProps {
  sessionToken: string;
  clientName: string;
  branding: PortalBranding | null;
  permissions: PortalPermissions;
  active: PortalNavKey;
  /** Smal kolonne til læse-/godkendelsessider, bred til tabeller. */
  width?: "wide" | "narrow";
  children: ReactNode;
}

/** Fanerne kunden må se — samme rækkefølge på alle portalsider. */
export function portalNavItems(
  permissions: PortalPermissions,
  t: (key: string) => string,
): { key: PortalNavKey; label: string; path: string }[] {
  const items: { key: PortalNavKey; label: string; path: string }[] = [
    { key: "overview", label: t("nav.overview"), path: "/portal/dashboard" },
  ];
  if (permissions.canViewInvoices) {
    items.push({
      key: "invoices",
      label: t("nav.invoices"),
      path: "/portal/dashboard?tab=invoices",
    });
  }
  if (permissions.canViewProjects) {
    items.push({
      key: "projects",
      label: t("nav.projects"),
      path: "/portal/dashboard?tab=projects",
    });
  }
  if (permissions.canViewTimeEntries) {
    items.push({
      key: "time",
      label: t("nav.time"),
      path: "/portal/dashboard?tab=time",
    });
  }
  if (permissions.canViewPrepaid) {
    items.push({
      key: "prepaid",
      label: t("nav.prepaid"),
      path: "/portal/dashboard?tab=prepaid",
    });
  }
  if (permissions.canViewTimeEntries) {
    items.push({
      key: "time-report",
      label: t("nav.timeReport"),
      path: "/portal/time-report",
    });
  }
  if (permissions.canApproveTime) {
    items.push({
      key: "approvals",
      label: t("nav.approvals"),
      path: "/portal/approvals",
    });
  }
  return items;
}

/**
 * Fælles ramme for alle portalsider: brand, kundenavn, navigation og log ud.
 * Tidsrapport og Godkendelser havde før hver deres (eller ingen) header, så
 * kunden mistede navigationen så snart de forlod oversigten.
 */
export function PortalShell({
  sessionToken,
  clientName,
  branding,
  permissions,
  active,
  width = "wide",
  children,
}: PortalShellProps) {
  const router = useRouter();
  const t = useTranslations("portal");
  const { isCustomDomain } = useCustomDomain();
  const nav = portalNavItems(permissions, t);

  const logout = trpc.publicPortal.logout.useMutation({
    onSuccess: () => {
      // Ryd både den generiske og alle token-scopede nøgler, så næste bruger
      // i samme browser ikke arver en session.
      clearPortalSessions();
      toast.success(t("shell.loggedOut"));
      router.push(getPortalPath("/portal/login", isCustomDomain));
    },
    onError: () => toast.error(t("shell.logoutFailed")),
  });

  const container =
    width === "narrow" ? "mx-auto max-w-4xl" : "mx-auto max-w-6xl";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
        <div
          className={`${container} flex h-14 items-center justify-between gap-4 px-4 sm:px-6`}
        >
          <Link
            href={getPortalPath("/portal/dashboard", isCustomDomain)}
            className="flex min-w-0 items-center gap-3"
          >
            {branding?.logoUrl ? (
              <Image
                src={branding.logoUrl}
                alt={branding.brandName || t("shell.logoAlt")}
                width={120}
                height={28}
                className="h-7 w-auto object-contain"
                sizes="120px"
              />
            ) : (
              <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                {branding?.brandName || t("title")}
              </span>
            )}
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden truncate text-xs text-gray-500 dark:text-gray-400 sm:block">
              {clientName}
            </span>
            <button
              type="button"
              onClick={() => logout.mutate({ sessionToken })}
              disabled={logout.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("shell.logout")}
            </button>
          </div>
        </div>
        {nav.length > 1 && (
          <div className={`${container} px-4 pb-2 sm:px-6`}>
            <nav
              aria-label={t("shell.navLabel")}
              className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
            >
              {nav.map((item) => {
                const isActive = item.key === active;
                return (
                  <Link
                    key={item.key}
                    href={getPortalPath(item.path, isCustomDomain)}
                    aria-current={isActive ? "page" : undefined}
                    className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className={`${container} w-full flex-1 px-4 py-6 sm:px-6`}>
        {children}
      </main>

      <footer className="border-t border-gray-200 py-5 dark:border-gray-800">
        {branding?.footerText && (
          <p className="mb-3 text-center text-xs text-gray-600 dark:text-gray-400">
            {branding.footerText}
          </p>
        )}
        <LeveretAfTimeTrack />
      </footer>
    </div>
  );
}

/** Centreret spinner til portalens indlæsning — samme på alle sider. */
export function PortalLoading({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900 dark:border-gray-700 dark:border-t-white" />
      {label && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      )}
    </div>
  );
}

/** Fejl fra en portal-query — ingen blank side. */
export function PortalQueryError({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations("portal");
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-900/10">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">
        {t("queryError.title")}
      </p>
      <p className="mt-1 text-xs text-red-700/80 dark:text-red-400">
        {t("queryError.text")}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          {t("queryError.retry")}
        </button>
      )}
    </div>
  );
}

/** Tom-tilstand efter designguiden. */
export function PortalEmpty({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
      <Icon className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
      <p className="text-sm font-medium text-gray-900 dark:text-white">
        {title}
      </p>
      {text && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{text}</p>
      )}
      {children}
    </div>
  );
}

/**
 * Tal, beløb og datoer i portalens sprog. Dansk giver "12,5", "1.250 kr" og
 * "5.11.2026" som før; andre sprog bruger Intl med samme sprogkode.
 */
export function usePortalFormat(currency: DemoCurrency = "DKK") {
  const locale = toIntlLocale(useLocale());
  const isDanish = locale === "da-DK";
  return {
    /** "12,5" — timer med højst to decimaler. */
    hours: (n: number | string): string =>
      Number(n).toLocaleString(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      }),
    /** Heltal med sprogets tusindtalsseparator. */
    number: (n: number | string): string => Number(n).toLocaleString(locale),
    /** "1.250 kr" (da) / "DKK 1,250" (andre). */
    money: (n: number | string): string =>
      isDanish && currency === "DKK"
        ? `${Number(n).toLocaleString(locale, { maximumFractionDigits: 0 })} kr`
        : Number(n).toLocaleString(locale, {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
          }),
    date: (d: Date | string | null | undefined): string =>
      d ? new Date(d).toLocaleDateString(locale) : "–",
    /** Udløbsdato som kalenderdato i dansk tid (som formatPrepaidExpiry). */
    expiry: (d: Date | string | null | undefined): string =>
      d
        ? new Date(d).toLocaleDateString(locale, {
            timeZone: "Europe/Copenhagen",
          })
        : "",
  };
}

/** Tabel-klasser genbrugt på tværs af portalens sider. */
export const portalTable = {
  wrap: "overflow-x-auto rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900",
  table: "w-full text-sm",
  th: "px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400",
  thRight:
    "px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400",
  headRow: "border-b border-gray-200 dark:border-gray-800",
  row: "border-b border-gray-100 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/50",
  td: "px-4 py-2.5 text-gray-900 dark:text-white",
  tdMuted: "px-4 py-2.5 text-gray-500 dark:text-gray-400",
  tdNum: "px-4 py-2.5 text-right tabular-nums text-gray-900 dark:text-white",
  foot: "border-t border-gray-200 bg-gray-50 text-xs font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-200",
};

export const portalBadge = {
  green:
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  amber:
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  red: "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  gray: "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  blue: "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  purple:
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
};
