"use client";

import { Check, ChevronDown, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FoundingCustomerBadge } from "@/components/ui/FoundingCustomerBadge";
import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
} from "@/lib/auth-client";
import { clearPrivateCaches } from "@/lib/pwa/private-caches";
import { trpc } from "@/providers/trpc-provider";

interface OrgSwitcherProps {
  collapsed: boolean;
}

export function OrgSwitcher({ collapsed }: OrgSwitcherProps) {
  const t = useTranslations("shell.org");
  const { data: activeOrgData } = useActiveOrganization();
  const { data: orgs } = useListOrganizations();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { data: founding } = trpc.organization.getFounding.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!orgs || orgs.length === 0) return null;

  const activeOrg = activeOrgData ?? null;

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrg?.id || switching) return;
    setSwitching(true);
    window.dispatchEvent(new Event("org-switch-start"));
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      // Clear persisted Zustand stores that may reference entities from the
      // previous org (projectId, clientId, etc.). The stores will reinitialise
      // with defaults after the reload.
      localStorage.removeItem("timer-storage");
      localStorage.removeItem("task-preferences");
      await clearPrivateCaches();
      window.location.reload();
    } catch {
      setSwitching(false);
      window.dispatchEvent(new Event("org-switch-end"));
    }
  };

  const displayOrg = activeOrg || orgs[0];
  const orgInitial = displayOrg?.name?.charAt(0).toUpperCase() || "O";

  if (collapsed) {
    return (
      <div className="relative px-4 pb-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400 text-xs font-bold mx-auto hover:bg-brand-200 dark:hover:bg-tt-gran-lys transition-colors"
          title={displayOrg?.name || t("fallbackName")}
        >
          {orgInitial}
        </button>
        {open && (
          <OrgDropdown
            orgs={orgs}
            activeOrgId={activeOrg?.id}
            switching={switching}
            onSwitch={handleSwitch}
            onClose={() => setOpen(false)}
            activeIsFounding={!!founding?.isFounding}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative px-4 pb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400 text-[10px] font-bold shrink-0">
          {orgInitial}
        </div>
        <span className="flex-1 text-left text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
          {displayOrg?.name || t("fallbackName")}
        </span>
        {founding?.isFounding && <FoundingCustomerBadge size="xs" />}
        <ChevronDown
          className={`h-3 w-3 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <OrgDropdown
          orgs={orgs}
          activeOrgId={activeOrg?.id}
          switching={switching}
          onSwitch={handleSwitch}
          onClose={() => setOpen(false)}
          activeIsFounding={!!founding?.isFounding}
        />
      )}
    </div>
  );
}

function OrgDropdown({
  orgs,
  activeOrgId,
  switching,
  onSwitch,
  onClose,
  activeIsFounding,
}: {
  orgs: Array<{ id: string; name: string; slug: string }>;
  activeOrgId: string | undefined;
  switching: boolean;
  onSwitch: (id: string) => void;
  onClose: () => void;
  activeIsFounding: boolean;
}) {
  const t = useTranslations("shell.org");
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap */}
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1 min-w-[200px]">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {t("list")}
        </div>
        {orgs.map((org) => (
          <button
            key={org.id}
            type="button"
            onClick={() => onSwitch(org.id)}
            disabled={switching}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400 text-[9px] font-bold shrink-0">
              {org.name.charAt(0).toUpperCase()}
            </div>
            <span className="flex-1 text-left truncate">{org.name}</span>
            {org.id === activeOrgId && activeIsFounding && (
              <FoundingCustomerBadge size="xs" />
            )}
            {org.id === activeOrgId && (
              <Check className="h-4 w-4 text-green-500 shrink-0" />
            )}
          </button>
        ))}
        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
        <Link
          href="/dashboard/organization"
          onClick={onClose}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span>{t("manage")}</span>
        </Link>
        <Link
          href="/dashboard/organization?create=true"
          onClick={onClose}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>{t("createNew")}</span>
        </Link>
      </div>
    </>
  );
}
