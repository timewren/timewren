"use client";

import { Lock } from "lucide-react";
import { useOrgRole } from "@/hooks/useOrgRole";

/**
 * Vises på indstillingssider, hvor kun ejere og administratorer kan gemme,
 * når et medlem lander der via et link. Serveren afviser ændringen alligevel;
 * her får medlemmet at vide hvorfor, før de prøver.
 *
 * Returnerer `canManage`, så siden kan slå sine knapper fra.
 */
export function useCanManageOrgSettings(): boolean {
  const { isResolved, canManage } = useOrgRole();
  // Optimistisk mens rollen hentes (solo-freelancere er ejere)
  return !isResolved || canManage;
}

export function AdminOnlyNotice({ children }: { children: React.ReactNode }) {
  const canManage = useCanManageOrgSettings();
  if (canManage) return null;
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
