"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  isAclLoading,
  type SettingsNavGroup,
  settingsNavGroups,
  translateSettingsGroups,
} from "@/components/dashboard-nav";
import { visibleSettingsGroups } from "@/components/dashboard-nav/settings-search";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useModules } from "@/hooks/useModules";
import { trpc } from "@/providers/trpc-provider";

const SUBSCRIPTION_HREF = "/dashboard/settings/subscription";

/**
 * De indstillingssider, brugeren kan se. Rolle- og modul-gatede punkter er
 * skjult, til rollen og modulerne er kendt (samme regel som sidemenuen), så
 * et medlem aldrig ser admin-sider blinke frem.
 */
export function useVisibleSettingsGroups(): SettingsNavGroup[] {
  const tNav = useTranslations("navSettings");
  const { isEnabled } = useFeatureFlags();
  const { enabled: billingEnabled } = useBillingEnabled();
  const {
    isEnabled: isModuleEnabled,
    isLoading: modulesLoading,
    isPlaceholder: modulesPlaceholder,
    orgProfile,
  } = useModules();
  const { data: myRoleData, isError: myRoleError } =
    trpc.rolePermissions.getMyRole.useQuery(undefined, {
      staleTime: 60_000,
      retry: 1,
    });
  const myRole = myRoleData?.role;
  const aclLoading = isAclLoading({
    modulesLoading,
    modulesPlaceholder,
    roleLoaded: !!myRoleData,
    roleError: myRoleError,
  });

  return useMemo(() => {
    const settled = settingsNavGroups.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        // Uden billing (selvhost) findes ingen abonnementsside
        if (!billingEnabled && item.href === SUBSCRIPTION_HREF) return false;
        if (item.requiresModule && modulesLoading) return false;
        if ((item.minRole || item.freelancerOnly) && aclLoading) return false;
        return true;
      }),
    }));
    const visible = visibleSettingsGroups(settled, {
      isFlagEnabled: isEnabled,
      isModuleEnabled,
      role: myRole,
      orgProfile,
    });
    return translateSettingsGroups(visible, tNav);
  }, [
    billingEnabled,
    isEnabled,
    isModuleEnabled,
    modulesLoading,
    aclLoading,
    myRole,
    orgProfile,
    tNav,
  ]);
}
