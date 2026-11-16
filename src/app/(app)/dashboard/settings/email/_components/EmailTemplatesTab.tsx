"use client";

import {
  Copy,
  Edit,
  FileText,
  Loader2,
  Mail,
  MoreVertical,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

type TemplateType =
  | "invoice"
  | "invoice_reminder"
  | "portal_welcome"
  | "portal_invitation"
  | "project_update"
  | "prepaid_alert"
  | "prepaid_expiry"
  | "time_approval"
  | "custom";

const TEMPLATE_TYPES: TemplateType[] = [
  "invoice",
  "invoice_reminder",
  "portal_welcome",
  "portal_invitation",
  "project_update",
  "prepaid_alert",
  "prepaid_expiry",
  "time_approval",
  "custom",
];

const templateTypeColors: Record<TemplateType, string> = {
  invoice: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  invoice_reminder:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  portal_welcome:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  portal_invitation:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  project_update:
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  prepaid_alert:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  prepaid_expiry:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  time_approval:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  custom: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

export function EmailTemplatesTab() {
  const t = useTranslations("settingsEmailTemplates");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [selectedType, setSelectedType] = useState<TemplateType | "all">("all");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: templates, isLoading } = trpc.emailTemplates.list.useQuery({
    includeInactive: true,
  });

  const duplicateMutation = trpc.emailTemplates.duplicate.useMutation({
    onSuccess: () => {
      utils.emailTemplates.list.invalidate();
      toast.success(t("duplicated"));
    },
    onError: (error) => {
      toast.error(error.message || t("duplicateFailed"));
    },
  });

  const deleteMutation = trpc.emailTemplates.delete.useMutation({
    onSuccess: () => {
      utils.emailTemplates.list.invalidate();
      toast.success(t("deleted"));
    },
    onError: (error) => {
      toast.error(error.message || t("deleteFailed"));
    },
  });

  const setDefaultMutation = trpc.emailTemplates.setDefault.useMutation({
    onSuccess: () => {
      utils.emailTemplates.list.invalidate();
      toast.success(t("defaultUpdated"));
    },
    onError: (error) => {
      toast.error(error.message || t("defaultFailed"));
    },
  });

  const createDefaultsMutation = trpc.emailTemplates.createDefaults.useMutation(
    {
      onSuccess: (data) => {
        utils.emailTemplates.list.invalidate();
        if (data.created > 0) {
          toast.success(t("defaultsCreated", { count: data.created }));
        } else {
          toast.info(t("alreadyHave"));
        }
      },
      onError: (error) => {
        toast.error(error.message || t("defaultsFailed"));
      },
    },
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  const filteredTemplates =
    selectedType === "all"
      ? templates
      : templates?.filter((tpl) => tpl.type === selectedType);

  const handleDuplicate = async (id: string) => {
    setOpenMenu(null);
    await duplicateMutation.mutateAsync({ id });
  };

  const handleDelete = (id: string) => {
    setOpenMenu(null);
    setDeleteConfirmId(id);
  };

  const handleSetDefault = async (id: string) => {
    setOpenMenu(null);
    await setDefaultMutation.mutateAsync({ id });
  };

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedType("all")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              selectedType === "all"
                ? "bg-tt-gran text-tt-paa-gran"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            {t("all")}
          </button>
          {TEMPLATE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                selectedType === type
                  ? "bg-tt-gran text-tt-paa-gran"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {t(`types.${type}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {(!templates || templates.length === 0) && (
            <button
              type="button"
              onClick={() => createDefaultsMutation.mutate()}
              disabled={createDefaultsMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {createDefaultsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {t("createDefaults")}
            </button>
          )}
          <Link
            href="/dashboard/settings/email-templates/new"
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <Plus className="h-4 w-4" />
            {t("newTemplate")}
          </Link>
        </div>
      </div>

      {/* Templates Grid */}
      {!filteredTemplates || filteredTemplates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center">
          <Mail className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            {t("emptyTitle")}
          </h3>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            {t("emptyText")}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => createDefaultsMutation.mutate()}
              disabled={createDefaultsMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t("createDefaults")}
            </button>
            <Link
              href="/dashboard/settings/email-templates/new"
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              <Plus className="h-4 w-4" />
              {t("createNew")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="group relative rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${templateTypeColors[template.type as TemplateType]}`}
                  >
                    {t(`types.${template.type as TemplateType}`)}
                  </span>
                  {template.isDefault && (
                    <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </span>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMenu(openMenu === template.id ? null : template.id)
                    }
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {openMenu === template.id && (
                    <div className="absolute right-0 top-8 z-10 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg">
                      <Link
                        href={`/dashboard/settings/email-templates/${template.id}`}
                        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Edit className="h-4 w-4" />
                        {t("edit")}
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDuplicate(template.id)}
                        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Copy className="h-4 w-4" />
                        {t("copy")}
                      </button>
                      {!template.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(template.id)}
                          className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Star className="h-4 w-4" />
                          {t("setDefault")}
                        </button>
                      )}
                      {!template.isSystem && (
                        <button
                          type="button"
                          onClick={() => handleDelete(template.id)}
                          className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4" />
                          {t("delete")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Link href={`/dashboard/settings/email-templates/${template.id}`}>
                <h3 className="mb-1 font-medium text-gray-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400">
                  {template.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                  {template.subject}
                </p>
              </Link>

              <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
                <span>
                  {t("usedCount", { count: template.usageCount || 0 })}
                </span>
                {template.lastUsedAt && (
                  <span>
                    {t("lastUsed", {
                      date: new Date(template.lastUsedAt).toLocaleDateString(
                        toIntlLocale(locale),
                      ),
                    })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Variables Reference */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {t("vars.title")}
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("vars.intro")}
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("vars.general")}
            </h3>
            <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{firmanavn}}"}
                </code>{" "}
                - {t("vars.companyName")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{dit_navn}}"}
                </code>{" "}
                - {t("vars.yourName")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{klientnavn}}"}
                </code>{" "}
                - {t("vars.clientName")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{klientfirma}}"}
                </code>{" "}
                - {t("vars.clientCompany")}
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("vars.invoice")}
            </h3>
            <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{fakturanummer}}"}
                </code>{" "}
                - {t("vars.invoiceNumber")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{fakturabeløb}}"}
                </code>{" "}
                - {t("vars.invoiceAmount")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{forfaldsdato}}"}
                </code>{" "}
                - {t("vars.dueDate")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{faktura_link}}"}
                </code>{" "}
                - {t("vars.invoiceLink")}
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("vars.prepaid")}
            </h3>
            <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{klippekort_saldo}}"}
                </code>{" "}
                - {t("vars.prepaidBalance")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{klippekort_brugt}}"}
                </code>{" "}
                - {t("vars.prepaidUsed")}
              </li>
              <li>
                <code className="text-brand-600 dark:text-brand-400">
                  {"{{klippekort_udløb}}"}
                </code>{" "}
                - {t("vars.prepaidExpiry")}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={async () => {
          if (deleteConfirmId) {
            await deleteMutation.mutateAsync({ id: deleteConfirmId });
            setDeleteConfirmId(null);
          }
        }}
        title={t("confirmTitle")}
        description={t("confirmText")}
        confirmLabel={t("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
