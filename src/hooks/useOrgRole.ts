// src/hooks/useOrgRole.ts
"use client";

import type { OrgRole } from "@/lib/permissions/org-role";
import { trpc } from "@/providers/trpc-provider";

export interface UseOrgRoleResult {
  isLoading: boolean;
  /** True once the server actually answered — false while loading or on error. */
  isResolved: boolean;
  role: OrgRole;
  /** owner or admin — may perform destructive org actions. */
  canManage: boolean;
  isSolo: boolean;
}

/**
 * The current user's role in the active organization. Use it to hide admin-only
 * actions (delete project, delete klippekort, manage members) from plain team
 * members so they don't see buttons the server will 403. While loading we
 * optimistically assume canManage=true so solo freelancers (the common case)
 * never see a flash of disabled controls; the real value arrives quickly.
 */
export function useOrgRole(): UseOrgRoleResult {
  const { data, isLoading } = trpc.organization.getMyRole.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    isLoading,
    isResolved: data !== undefined,
    role: data?.role ?? "owner",
    canManage: data?.canManage ?? true,
    isSolo: data?.isSolo ?? true,
  };
}
