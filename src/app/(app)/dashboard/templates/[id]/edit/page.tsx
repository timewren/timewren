"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  TemplateForm,
  type TemplateFormValues,
} from "@/components/templates/TemplateForm";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

export default function EditTemplatePage() {
  const t = useTranslations("templatesPage");
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: template, isLoading } = trpc.recurring.getById.useQuery(
    { id },
    { enabled: !!id },
  );

  const updateMutation = trpc.recurring.update.useMutation({
    onSuccess: () => {
      toast.success(t("updated"));
      router.push("/dashboard/templates");
    },
    onError: (error) => {
      toast.error(error.message || t("updateFailed"));
    },
  });

  const handleSubmit = async (data: TemplateFormValues) => {
    setIsSubmitting(true);
    try {
      await updateMutation.mutateAsync({
        id,
        name: data.name,
        templateType: data.templateType,
        clientId: data.clientId || null,
        projectId: data.projectId || null,
        clientIds: data.clientIds,
        description: data.description,
        hours: data.hours || "0",
        frequency: data.isRecurring ? (data.frequency ?? null) : null,
        dayOfWeek: data.dayOfWeek ? Number.parseInt(data.dayOfWeek, 10) : null,
        dayOfMonth: data.dayOfMonth
          ? Number.parseInt(data.dayOfMonth, 10)
          : null,
        startDate: data.isRecurring ? (data.startDate ?? null) : null,
        endDate: data.endDate || null,
        isPrepaid: data.isPrepaid,
      });
    } catch (_error) {
      // Error handled by mutation
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <LoadingScreen message={t("editLoading")} />;
  }

  if (!template) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          href="/dashboard/templates"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToTemplates")}
        </Link>
        <p className="text-gray-600 dark:text-gray-400">{t("notFound")}</p>
      </div>
    );
  }

  const templateClients = template.templateClients;

  const defaultValues: Partial<TemplateFormValues> = {
    name: template.name,
    templateType:
      (template.templateType as TemplateFormValues["templateType"] | null) ||
      "time_entry",
    clientId: template.clientId || "",
    projectId: template.projectId || "",
    clientIds: templateClients?.map((tc) => ({
      clientId: tc.clientId,
      projectId: tc.projectId ?? null,
    })),
    description: template.description,
    hours: template.hours,
    isRecurring: !!template.frequency,
    frequency:
      (template.frequency as "daily" | "weekly" | "monthly") || "weekly",
    dayOfWeek: template.dayOfWeek?.toString() || "",
    dayOfMonth: template.dayOfMonth?.toString() || "",
    startDate: template.startDate
      ? toLocalDateStr(new Date(template.startDate))
      : toLocalDateStr(new Date()),
    endDate: template.endDate ? toLocalDateStr(new Date(template.endDate)) : "",
    isPrepaid: template.isPrepaid ?? false,
    prepaidPackageId: template.prepaidPackageId || "",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href="/dashboard/templates"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToTemplates")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("editTitle")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("editSubtitle", { name: template.name })}
        </p>
      </div>

      <TemplateForm
        mode="edit"
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
