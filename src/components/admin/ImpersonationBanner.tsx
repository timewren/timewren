"use client";

import { LogOut, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";

/**
 * Banner rendered at the top of the dashboard whenever the current session
 * was created through Better-Auth's admin plugin impersonation flow.
 *
 * The session object carries an `impersonatedBy` field (admin's userId)
 * when an impersonation is active. A "stop" button calls the plugin's
 * stopImpersonating endpoint which restores the original admin session.
 */
export function ImpersonationBanner() {
  const t = useTranslations("adminShell");
  const { data: session } = useSession();
  const [stopping, setStopping] = useState(false);

  const impersonatedBy = (
    session?.session as { impersonatedBy?: string | null } | undefined
  )?.impersonatedBy;

  if (!session?.user || !impersonatedBy) {
    return null;
  }

  const handleStop = async () => {
    setStopping(true);
    try {
      const { error } = await authClient.admin.stopImpersonating();
      if (error) {
        toast.error(
          t("impersonation.stopFailed", {
            message: error.message ?? t("impersonation.unknownError"),
          }),
        );
        return;
      }
      toast.success(t("impersonation.stopped"));
      // Hard reload so all queries refetch for the restored admin session
      window.location.href = "/admin";
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("impersonation.stopFailedShort"),
      );
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-amber-300 bg-amber-100 px-4 py-2 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-amber-900">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          {t.rich("impersonation.banner", {
            name: session.user.name || session.user.email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </span>
      </div>
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
      >
        <LogOut className="h-3.5 w-3.5" />
        {stopping ? t("impersonation.stopping") : t("impersonation.stop")}
      </button>
    </div>
  );
}
