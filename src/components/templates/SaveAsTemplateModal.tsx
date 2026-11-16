"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";
import { TemplateForm, type TemplateFormValues } from "./TemplateForm";

interface SaveAsTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultName?: string;
  defaultDescription?: string;
  defaultProjectId?: string | null;
  defaultClientId?: string | null;
  defaultHours?: string | null;
  defaultTemplateType?: "time_entry" | "task" | "both";
}

export function SaveAsTemplateModal({
  isOpen,
  onClose,
  defaultName = "",
  defaultDescription = "",
  defaultProjectId = null,
  defaultClientId = null,
  defaultHours = null,
  defaultTemplateType = "time_entry",
}: SaveAsTemplateModalProps) {
  const t = useTranslations("templates");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  const utils = trpc.useUtils();

  const createMutation = trpc.recurring.create.useMutation({
    onSuccess: () => {
      toast.success(t("saveAs.created"));
      utils.recurring.list.invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(error.message || t("saveAs.createFailed"));
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

  if (!isOpen) return null;

  const formDefaults: Partial<TemplateFormValues> = {
    name: defaultName,
    description: defaultDescription || "",
    templateType: defaultTemplateType,
    hours: defaultHours || "",
    isRecurring: false,
    isPrepaid: false,
    ...(defaultClientId
      ? {
          clientId: defaultClientId,
          clientIds: [
            {
              clientId: defaultClientId,
              projectId: defaultProjectId ?? null,
            },
          ],
        }
      : {}),
    ...(defaultProjectId && !defaultClientId
      ? { projectId: defaultProjectId }
      : {}),
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl mx-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {defaultName ? t("saveAs.saveAs") : t("saveAs.new")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("saveAs.close")}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          <TemplateForm
            key={isOpen ? "open" : "closed"}
            mode="create"
            layout="modal"
            defaultValues={formDefaults}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
        </div>
      </div>
    </div>
  );
}
