"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NotificationToggle } from "@/components/settings/NotificationToggle";
import { useModules } from "@/hooks/useModules";
import {
  NOTIFICATION_GROUPS,
  type NotificationChannelKey,
  type NotificationGroup,
} from "@/lib/notifications/bus/groups";
import { trpc } from "@/providers/trpc-provider";

type UserMatrix = Record<
  NotificationGroup,
  Record<NotificationChannelKey, boolean>
>;

/**
 * Bruger-indstillinger → Notifikationer: præferencer for organisationens
 * hændelser (timesedler, fravær, påmindelser …) pr. kanal. Vises kun når
 * brugeren er medlem af en organisation.
 */
export function OrgNotificationPreferences() {
  const t = useTranslations("settingsNotificationsOrg");
  const utils = trpc.useUtils();
  const { isEnabled } = useModules();
  const enterprise = isEnabled("enterprise");
  const { data, error } = trpc.enterprise.getMyNotificationPreferences.useQuery(
    undefined,
    { retry: false, enabled: enterprise },
  );
  const [matrix, setMatrix] = useState<UserMatrix | null>(null);

  useEffect(() => {
    if (data) setMatrix(data.effective as UserMatrix);
  }, [data]);

  const saveMutation =
    trpc.enterprise.updateMyNotificationPreferences.useMutation({
      onSuccess: () => {
        utils.enterprise.getMyNotificationPreferences.invalidate();
        toast.success(t("saved"));
      },
      onError: (e) => toast.error(e.message || t("saveFailed")),
    });

  // Ingen enterprise-org (freelancer) → sektionen findes ikke
  if (!enterprise || error || !data || !matrix) return null;

  const userChannels = data.userChannels as readonly NotificationChannelKey[];

  const toggle = (
    group: NotificationGroup,
    channel: NotificationChannelKey,
    value: boolean,
  ) => {
    const next = {
      ...matrix,
      [group]: { ...matrix[group], [channel]: value },
    };
    setMatrix(next);
    // Gem kun bruger-kanalerne; Teams ejes af organisationen
    const prefs: Record<string, Record<string, boolean>> = {};
    for (const g of NOTIFICATION_GROUPS) {
      prefs[g] = {};
      for (const c of userChannels) prefs[g][c] = next[g][c];
    }
    saveMutation.mutate({ preferences: prefs });
  };

  return (
    <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="flex items-start gap-4 mb-6">
        <div className="h-12 w-12 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
          <Building2 className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("intro")}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {NOTIFICATION_GROUPS.filter((g) => g !== "digest").map((group) => (
          <div key={group}>
            <div className="mb-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {t(`groups.${group}`)}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(`groupDescriptions.${group}`)}
              </p>
            </div>
            <div className="space-y-3 pl-6">
              {userChannels.map((channel) => (
                <NotificationToggle
                  key={channel}
                  label={t(`channels.${channel}`)}
                  checked={matrix[group][channel]}
                  onChange={(v) => toggle(group, channel, v)}
                  disabled={saveMutation.isPending}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
