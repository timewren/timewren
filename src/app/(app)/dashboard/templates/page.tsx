"use client";

import {
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Edit,
  FileText,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ConfirmDialog } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

export default function RecurringTemplatesPage() {
  const t = useTranslations("templatesPage");
  const intlLocale = toIntlLocale(useLocale());
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const {
    data: templates,
    isLoading,
    refetch,
  } = trpc.recurring.list.useQuery();
  const { data: pendingTemplates, refetch: refetchPending } =
    trpc.recurring.getPending.useQuery();

  const toggleMutation = trpc.recurring.toggleActive.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("updated"));
    },
    onError: (error) => {
      toast.error(error.message || t("updateFailed"));
    },
  });

  const generateMutation = trpc.recurring.generate.useMutation({
    onSuccess: () => {
      refetch();
      refetchPending();
      toast.success(t("entryCreated"));
    },
    onError: (error) => {
      toast.error(error.message || t("entryFailed"));
    },
  });

  const duplicateMutation = trpc.recurring.duplicate.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("duplicated"));
    },
    onError: (error) => {
      toast.error(error.message || t("duplicateFailed"));
    },
  });

  const deleteMutation = trpc.recurring.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("deleted"));
    },
    onError: (error) => {
      toast.error(error.message || t("deleteFailed"));
    },
  });

  const handleToggle = async (id: string) => {
    await toggleMutation.mutateAsync({ id });
  };

  const handleGenerate = async (id: string) => {
    await generateMutation.mutateAsync({ templateId: id });
  };

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const filteredTemplates = templates?.filter((template) => {
    if (filter === "active") return template.isActive;
    if (filter === "inactive") return !template.isActive;
    return true;
  });

  const getFrequencyLabel = (frequency: string | null) => {
    if (!frequency) return null;
    return ["daily", "weekly", "monthly"].includes(frequency)
      ? t(`freq.${frequency}`)
      : frequency;
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "–";
    return new Date(date).toLocaleDateString(intlLocale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getTemplateClientName = (
    template: NonNullable<typeof templates>[number],
  ) => {
    // Direct client on template
    const directClient = template.client
      ? Array.isArray(template.client)
        ? template.client[0]
        : template.client
      : null;
    if (directClient?.name) return directClient.name;

    // Client via project
    const proj = Array.isArray(template.project)
      ? template.project[0]
      : template.project;
    const projClient = proj?.client
      ? Array.isArray(proj.client)
        ? proj.client[0]
        : proj.client
      : null;
    if (projClient?.name) return projClient.name;

    return null;
  };

  const getTemplateProjectName = (
    template: NonNullable<typeof templates>[number],
  ) => {
    const proj = Array.isArray(template.project)
      ? template.project[0]
      : template.project;
    return proj?.name || null;
  };

  const isRecurring = (template: NonNullable<typeof templates>[number]) =>
    !!template.frequency;

  const getTypeBadge = (templateType: string | null | undefined) => {
    switch (templateType) {
      case "task":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">
            <CheckCircle2 className="h-3 w-3" />
            {t("type.task")}
          </span>
        );
      case "both":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">
            <Clock className="h-3 w-3" />
            <CheckCircle2 className="h-3 w-3" />
            {t("type.both")}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">
            <Clock className="h-3 w-3" />
            {t("type.time")}
          </span>
        );
    }
  };

  if (isLoading) {
    return <LoadingScreen message={t("loading")} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title={t("title")}
        description={t("description")}
        helpTopicId="templates"
        actions={
          <Link
            href="/dashboard/templates/new"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-tt-gran px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk shrink-0"
          >
            <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
            {t("new")}
          </Link>
        }
      />

      {/* Pending Templates Alert */}
      {pendingTemplates && pendingTemplates.length > 0 && (
        <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
          <div className="flex items-start gap-4">
            <RefreshCw className="h-6 w-6 shrink-0 text-brand-600 dark:text-brand-400" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("pendingTitle", { count: pendingTemplates.length })}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {t("pendingBody")}
              </p>
              <div className="mt-3 space-y-2">
                {pendingTemplates.map((template) => {
                  const clientName = getTemplateClientName(
                    template as typeof templates extends (infer T)[] | undefined
                      ? T
                      : never,
                  );
                  const projectName = getTemplateProjectName(
                    template as typeof templates extends (infer T)[] | undefined
                      ? T
                      : never,
                  );
                  return (
                    <div
                      key={template.id}
                      className="flex items-center justify-between rounded-lg border border-brand-200 dark:border-brand-600 bg-white dark:bg-gray-900 p-3"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {template.name}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {clientName || t("global")}
                          {projectName ? ` • ${projectName}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleGenerate(template.id)}
                        disabled={generateMutation.isPending}
                        className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                      >
                        {t("generateNow")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            filter === "all"
              ? "bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          }`}
        >
          {t("filterAll")}
        </button>
        <button
          type="button"
          onClick={() => setFilter("active")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            filter === "active"
              ? "bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          }`}
        >
          {t("filterActive")}
        </button>
        <button
          type="button"
          onClick={() => setFilter("inactive")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            filter === "inactive"
              ? "bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          }`}
        >
          {t("filterInactive")}
        </button>
      </div>

      {/* Templates List */}
      {!filteredTemplates || filteredTemplates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            {t("emptyTitle")}
          </h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("emptyBody")}
          </p>
          <Link
            href="/dashboard/templates/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            <Plus className="h-4 w-4" />
            {t("createFirst")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredTemplates.map((template) => {
            const recurring = isRecurring(template);
            const clientName = getTemplateClientName(template);
            const projectName = getTemplateProjectName(template);
            const freqLabel = getFrequencyLabel(template.frequency);
            const templateType = (template as Record<string, unknown>)
              .templateType as string | null | undefined;
            const templateClients = (template as Record<string, unknown>)
              .templateClients as
              | { client?: { name?: string }; project?: { name?: string } }[]
              | undefined;

            return (
              <div
                key={template.id}
                className={`rounded-xl border p-6 transition-all ${
                  template.isActive
                    ? "border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900"
                    : "border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 opacity-60"
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {template.name}
                      </h3>
                      {recurring ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 dark:bg-tt-gran-lys px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-400">
                          <Repeat className="h-3 w-3" />
                          {t("recurring")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                          <FileText className="h-3 w-3" />
                          {t("template")}
                        </span>
                      )}
                      {getTypeBadge(templateType)}
                    </div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {templateClients && templateClients.length > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {t("clientCount", { count: templateClients.length })}
                        </span>
                      ) : (
                        clientName || t("globalTemplate")
                      )}
                      {projectName ? ` • ${projectName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(template.id)}
                      disabled={toggleMutation.isPending}
                      className="rounded-lg p-2 text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                      title={
                        template.isActive ? t("deactivate") : t("activate")
                      }
                    >
                      {template.isActive ? (
                        <ToggleRight className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Details */}
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Clock className="h-4 w-4" />
                    {t("hoursLine", { hours: template.hours })}
                    {freqLabel ? ` • ${freqLabel}` : ""}
                  </div>
                  {recurring && template.nextDue && (
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                      <Calendar className="h-4 w-4" />
                      {t("next", { date: formatDate(template.nextDue) })}
                    </div>
                  )}
                  {template.description && (
                    <p className="text-gray-600 dark:text-gray-400">
                      {template.description}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <button
                    type="button"
                    onClick={() => handleGenerate(template.id)}
                    disabled={!template.isActive || generateMutation.isPending}
                    className="flex-1 rounded-lg border border-brand-600 dark:border-brand-500 bg-white dark:bg-transparent px-3 py-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 transition-colors hover:bg-brand-50 dark:hover:bg-tt-gran-lys disabled:opacity-50"
                  >
                    {recurring ? (
                      <>
                        <RefreshCw className="mr-1 inline-block h-4 w-4" />
                        {t("generateNow")}
                      </>
                    ) : (
                      <>
                        <Play className="mr-1 inline-block h-4 w-4" />
                        {t("useTemplate")}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      duplicateMutation.mutate({ id: template.id })
                    }
                    disabled={duplicateMutation.isPending}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                    title={t("copyTemplate")}
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <Link
                    href={`/dashboard/templates/${template.id}/edit`}
                    aria-label={t("editTemplate")}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <Edit className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(template.id)}
                    disabled={deleteMutation.isPending}
                    aria-label={t("deleteTemplate")}
                    className="rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-transparent p-2 text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={async () => {
          if (deleteConfirmId) {
            await deleteMutation.mutateAsync({ id: deleteConfirmId });
            setDeleteConfirmId(null);
          }
        }}
        title={t("deleteTemplate")}
        description={t("deleteConfirm")}
        confirmLabel={t("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
