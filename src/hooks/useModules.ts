// src/hooks/useModules.ts
"use client";

import { useMemo } from "react";
import type { ModuleKey } from "@/lib/modules/constants";
import { CORE_BUNDLE, MODULE_KEYS } from "@/lib/modules/constants";
import { DEFAULT_ORG_REGION, type OrgRegion } from "@/lib/org/region";
import { trpc } from "@/providers/trpc-provider";

export interface UseModulesResult {
  isLoading: boolean;
  /** True mens den optimistiske CORE_BUNDLE-placeholder vises (rigtige
   * moduldata endnu ikke hentet). Destruktive beslutninger (redirect/toast)
   * må ALDRIG træffes på placeholder — den mangler ikke-core moduler som tasks. */
  isPlaceholder: boolean;
  /** True hvis moduldata-hentningen fejlede (retries opbrugt). Gates må da
   * IKKE redirecte/toaste — backend-modulguarden er den autoritative kontrol. */
  isError: boolean;
  isEnabled: (key: ModuleKey) => boolean;
  isAvailable: (key: ModuleKey) => boolean;
  enabledKeys: ModuleKey[];
  /** "enterprise" = internal time tracking org (no freelance CRM). Placeholder
   * is "freelance" — check `isPlaceholder` before acting on it. */
  orgProfile: OrgProfile;
  /** Medlemmer plus ventende invitationer; undefined indtil det er hentet. */
  teamSize: number | undefined;
  /** Organisationens valuta, land og sprog (DKK og Danmark som pladsholder). */
  region: OrgRegion;
}

export type OrgProfile = "freelance" | "enterprise";

/**
 * Optimistic placeholder used while the real modules query resolves. Uses
 * CORE_BUNDLE so a brand-new opt-in org (only core modules enabled) renders the
 * correct nav without a flash of non-core items. Returning freelance orgs may
 * see their extra (non-core) modules flash IN once real data arrives — far less
 * jarring than showing-then-removing items they don't have. Enterprise-only
 * features still gate correctly because `enterprise` is not in CORE_BUNDLE.
 */
const PLACEHOLDER_RESPONSE = {
  id: null,
  name: null,
  slug: null,
  metadata: null,
  orgProfile: "freelance" as const,
  teamSize: null,
  region: DEFAULT_ORG_REGION,
  modules: CORE_BUNDLE.map((key) => ({
    key,
    isAvailable: true,
    isEnabled: true,
  })),
};

export function useModules(): UseModulesResult {
  const { data, isLoading, isPlaceholderData, isError } =
    trpc.organization.getCurrent.useQuery(undefined, {
      staleTime: 5 * 60 * 1000, // 5 min — modules change rarely
      retry: 1,
      placeholderData: PLACEHOLDER_RESPONSE,
    });

  return useMemo<UseModulesResult>(() => {
    const byKey = new Map(
      (data?.modules ?? []).map((m) => [
        m.key as ModuleKey,
        { available: m.isAvailable, enabled: m.isEnabled },
      ]),
    );
    const isAvailable = (key: ModuleKey) => byKey.get(key)?.available ?? false;
    const isEnabled = (key: ModuleKey) => {
      const s = byKey.get(key);
      return Boolean(s?.available && s?.enabled);
    };
    const enabledKeys = MODULE_KEYS.filter(isEnabled);
    return {
      isLoading,
      isPlaceholder: Boolean(isPlaceholderData),
      isError,
      isEnabled,
      isAvailable,
      enabledKeys,
      orgProfile: data?.orgProfile ?? "freelance",
      teamSize: data?.teamSize ?? undefined,
      region: data?.region ?? DEFAULT_ORG_REGION,
    };
  }, [data, isLoading, isPlaceholderData, isError]);
}
