"use client";

import { ShieldOff } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { type OrgRole, roleSatisfies } from "@/lib/permissions/org-role";
import { trpc } from "@/providers/trpc-provider";

interface RoleGuardProps {
  /** Minimum org role required (member < manager < hr < admin < owner). */
  minRole: "manager" | "hr" | "admin";
  /**
   * Roller der afvises selvom minRole er opfyldt — fx hr på Team-godkendelse
   * (read-all-rolle uden skriverettigheder, #464).
   */
  excludeRoles?: OrgRole[];
  children: React.ReactNode;
}

/**
 * Client-side role gate for manager/admin pages. Shows a friendly Danish
 * "no access" state instead of the raw FORBIDDEN error from tRPC. The server
 * procedures (orgManagerProcedure / orgAdminProcedure) remain authoritative —
 * on query error we render the children and let the backend enforce.
 */
export function RoleGuard({ minRole, excludeRoles, children }: RoleGuardProps) {
  const t = useTranslations("shell.guard");
  const { data, isLoading, isError } = trpc.rolePermissions.getMyRole.useQuery(
    undefined,
    { staleTime: 60_000, retry: 1 },
  );

  if (isLoading) {
    return (
      <div className="py-16">
        <InlineSpinner className="h-6 w-6" />
      </div>
    );
  }

  const excluded = !!data?.role && !!excludeRoles?.includes(data.role);
  const allowed = isError || (roleSatisfies(data?.role, minRole) && !excluded);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
          <ShieldOff className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("noAccessTitle")}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {excluded
            ? t("hrCannotApprove")
            : minRole === "admin"
              ? t("adminOnly")
              : minRole === "hr"
                ? t("hrOnly")
                : t("managerOnly")}{" "}
          {t("contactAdmin")}
        </p>
        <Link
          href="/dashboard/enterprise/timesheet"
          className="mt-6 inline-flex items-center rounded-md bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          {t("goToTimesheet")}
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
