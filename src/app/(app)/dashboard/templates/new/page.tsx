"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  TemplateForm,
  type TemplateFormValues,
} from "@/components/templates/TemplateForm";
import { trpc } from "@/providers/trpc-provider";

export default function NewTemplatePage() {
  const t = useTranslations("templatesPage");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createMutation = trpc.recurring.create.useMutation({
    onSuccess: () => {
      router.push("/dashboard/templates");
    },
  });

  const handleSubmit = async (data: TemplateFormValues) => {
    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync({
        name: data.name,
        templateType: data.templateType,
        clientId: data.clientId || null,
        projectId: data.projectId || null,
        clientIds: data.clientIds,
        description: data.description,
        hours: data.hours || "0",
        frequency: data.isRecurring ? (data.frequency ?? null) : null,
        dayOfWeek: data.dayOfWeek
          ? Number.parseInt(data.dayOfWeek, 10)
          : undefined,
        dayOfMonth: data.dayOfMonth
          ? Number.parseInt(data.dayOfMonth, 10)
          : undefined,
        startDate: data.isRecurring ? data.startDate : undefined,
        endDate: data.endDate || undefined,
        isPrepaid: data.isPrepaid,
        isActive: true,
      });
    } catch (_error) {
      // Error handled by mutation
    } finally {
      setIsSubmitting(false);
    }
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
          {t("newTitle")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("newDescription")}
        </p>
      </div>

      <TemplateForm
        mode="create"
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
