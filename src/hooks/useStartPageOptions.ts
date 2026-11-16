"use client";

import { useMemo } from "react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useModules } from "@/hooks/useModules";
import { isStartPageVisible, START_PAGE_OPTIONS } from "@/lib/start-page";
import { trpc } from "@/providers/trpc-provider";

/**
 * De startside-valg (#startside) brugeren faktisk kan vælge lige nu — samme
 * modul-/rolle-/feature-flag-gating som selve navigationen (DashboardShell).
 */
export function useStartPageOptions() {
  const { isEnabled: isFlagEnabled } = useFeatureFlags();
  const { isEnabled: isModuleEnabled, orgProfile } = useModules();
  const { data: myPerms } = trpc.rolePermissions.getMyPermissions.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const { data: myRoleData } = trpc.rolePermissions.getMyRole.useQuery(
    undefined,
    { staleTime: 60_000, retry: 1 },
  );

  const canAccessModule = useMemo(
    () => (permModule: string) => {
      if (!myPerms) return true;
      const p = myPerms.find((x) => x.moduleKey === permModule);
      return (p?.accessLevel ?? "write") !== "none";
    },
    [myPerms],
  );

  return useMemo(
    () =>
      START_PAGE_OPTIONS.filter((option) =>
        isStartPageVisible(option.href, {
          isFlagEnabled,
          isModuleEnabled,
          canAccessModule,
          role: myRoleData?.role,
          orgProfile,
        }),
      ),
    [
      isFlagEnabled,
      isModuleEnabled,
      canAccessModule,
      myRoleData?.role,
      orgProfile,
    ],
  );
}
