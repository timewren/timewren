"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { usePermission } from "@/hooks/usePermission";

/**
 * Blocks a page when the caller's role has "none" access to the given
 * rolePermissions module. Owners always have full access. Complements
 * ModuleGuard (which checks whether the module is available to the org at all):
 * this checks whether the caller's ROLE may access it. "read" and "write" both
 * pass — write-level actions are gated separately at the procedure/button level.
 */
export function RoleModuleGuard({
  module,
  children,
}: {
  module: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("shell.guard");
  const { canRead, isLoading } = usePermission(module);
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!canRead) {
      toast.error(t("roleModuleDenied"));
      router.replace("/dashboard");
    }
  }, [canRead, isLoading, router, t]);

  if (isLoading || !canRead) return null;
  return <>{children}</>;
}
