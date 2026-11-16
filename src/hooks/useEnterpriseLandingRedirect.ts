"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { resolveEnterpriseMember } from "@/components/dashboard-nav";
import {
  useEnterpriseMemberHint,
  usePersistEnterpriseMemberHint,
} from "@/hooks/useEnterpriseMemberHint";
import { useModules } from "@/hooks/useModules";
import { trpc } from "@/providers/trpc-provider";

/**
 * Enterprise landing: members/managers/HR in an enterprise-profile org go
 * straight to their timesheet instead of the freelance pages (Hjem and
 * Overblik). Only decided on real data (never on the placeholder / while
 * loading / on error).
 *
 * Returns `hold` = true while the page must render nothing: either the
 * redirect is happening, or the user is (sticky hint) or may be (known
 * enterprise org, role unknown) an enterprise member — so the freelance page
 * never mounts briefly before the redirect. Freelancers never wait; on a
 * failed role/module query the page renders as normal.
 */
export function useEnterpriseLandingRedirect(): { hold: boolean } {
  const {
    orgProfile,
    isLoading: modulesLoading,
    isPlaceholder: modulesPlaceholder,
    isError: modulesError,
  } = useModules();
  const router = useRouter();

  const { data: myRole, isError: myRoleError } =
    trpc.rolePermissions.getMyRole.useQuery(undefined, {
      staleTime: 60_000,
      retry: 1,
    });

  const modulesReady = !modulesLoading && !modulesPlaceholder && !modulesError;
  const knownEnterpriseOrg = modulesReady && orgProfile === "enterprise";
  const redirectToTimesheet =
    knownEnterpriseOrg &&
    (myRole?.role === "member" ||
      myRole?.role === "manager" ||
      myRole?.role === "hr");

  const enterpriseMemberHint = useEnterpriseMemberHint();
  const { isMember: hintedMember, resolved: memberResolved } =
    resolveEnterpriseMember({
      orgProfile: modulesReady ? orgProfile : undefined,
      role: myRole?.role,
      roleLoaded: !!myRole,
      hint: enterpriseMemberHint,
    });
  usePersistEnterpriseMemberHint(memberResolved, hintedMember);
  const awaitingRole =
    !memberResolved &&
    !myRoleError &&
    !modulesError &&
    (hintedMember || knownEnterpriseOrg);

  useEffect(() => {
    if (redirectToTimesheet) router.replace("/dashboard/enterprise/timesheet");
  }, [redirectToTimesheet, router]);

  return { hold: redirectToTimesheet || awaitingRole };
}
