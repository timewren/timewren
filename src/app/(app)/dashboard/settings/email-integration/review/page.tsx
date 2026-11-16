"use client";

import { CheckCircle2, Filter, Mail, User } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

export default function EmailReviewPage() {
  const t = useTranslations("settingsEmailIntegration.review");
  const locale = useLocale();
  const { data: session, isPending } = useSession();
  const utils = trpc.useUtils();
  const [selectedClient, setSelectedClient] = useState<Record<string, string>>(
    {},
  );

  const { data: tasks, isLoading } =
    trpc.emailTasks.getTasksNeedingReview.useQuery({ limit: 50 });
  const { data: clients } = trpc.clients.list.useQuery();

  const updateMatchMutation = trpc.emailTasks.updateCustomerMatch.useMutation({
    onSuccess: () => {
      utils.emailTasks.getTasksNeedingReview.invalidate();
      toast.success(t("clientUpdated"));
    },
    onError: (error) => {
      toast.error(error.message || t("clientUpdateFailed"));
    },
  });

  if (isPending || isLoading) {
    return <LoadingScreen message={t("loading")} />;
  }

  if (!session) {
    return null;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Mail className="h-4 w-4" />
          <Link
            href="/dashboard/settings/email?tab=integration"
            className="hover:text-gray-700 dark:hover:text-gray-300"
          >
            {t("breadcrumb")}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">{t("intro")}</p>
      </div>

      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <Filter className="h-4 w-4" /> {t("toReview")}
        </div>
        <div className="mt-4 space-y-4">
          {tasks && tasks.length > 0 ? (
            tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-lg border border-gray-100 dark:border-gray-800 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      href={`/dashboard/tasks/${task.id}`}
                      className="text-sm font-semibold text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {task.title}
                    </Link>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t("created", {
                        date: new Date(task.createdAt).toLocaleString(
                          toIntlLocale(locale),
                        ),
                      })}
                    </p>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("confidence", { value: task.aiConfidence ?? t("na") })}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <User className="h-4 w-4" /> {t("client")}
                  </div>
                  <div className="w-full sm:w-64">
                    <ClientSearchCombobox
                      clients={clients}
                      value={selectedClient[task.id] || ""}
                      onChange={(v) =>
                        setSelectedClient((prev) => ({
                          ...prev,
                          [task.id]: v,
                        }))
                      }
                      placeholder={t("chooseClient")}
                    />
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
                    onClick={() => {
                      const clientId = selectedClient[task.id];
                      if (!clientId) {
                        toast.error(t("chooseClientFirst"));
                        return;
                      }
                      updateMatchMutation.mutate({
                        taskId: task.id,
                        clientId,
                      });
                    }}
                    disabled={updateMatchMutation.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4" /> {t("save")}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("none")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
