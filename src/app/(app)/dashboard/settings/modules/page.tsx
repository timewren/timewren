"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import {
  AdminOnlyNotice,
  useCanManageOrgSettings,
} from "@/components/settings/AdminOnlyNotice";
import type { ModuleKey } from "@/lib/modules/constants";
import { trpc } from "@/providers/trpc-provider";

export default function ModulesSettingsPage() {
  const t = useTranslations("settingsModules");
  const utils = trpc.useUtils();
  const canManage = useCanManageOrgSettings();
  const { data, isLoading } = trpc.organization.getCurrent.useQuery();

  const mutation = trpc.organization.setModuleEnabled.useMutation({
    onSuccess: () => {
      toast.success(t("updated"));
      utils.organization.getCurrent.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6 text-sm text-gray-500 dark:border-gray-700">
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <AdminOnlyNotice>{t("adminOnly")}</AdminOnlyNotice>

      {(!data?.modules || data.modules.length === 0) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
          {t("none")}
        </div>
      )}

      <div className="space-y-2">
        {data?.modules?.map((m) => (
          <div
            key={m.key}
            className="flex items-start justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-700"
          >
            <div className="flex-1 pr-4">
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {t(`labels.${m.key as ModuleKey}`)}
              </div>
              <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t(`descriptions.${m.key as ModuleKey}`)}
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={m.isEnabled}
                disabled={!canManage || mutation.isPending}
                onChange={(e) =>
                  mutation.mutate({
                    moduleKey: m.key as ModuleKey,
                    enabled: e.target.checked,
                  })
                }
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {m.isEnabled ? t("enabled") : t("disabled")}
              </span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
