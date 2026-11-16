// src/app/dashboard/reports/_components/SaveTemplateDialog.tsx
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";

interface Props {
  open: boolean;
  config: ReportTemplateConfig;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export function SaveTemplateDialog({ open, config, onClose, onSaved }: Props) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) nameInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);
  const utils = trpc.useUtils();
  const create = trpc.reportTemplates.create.useMutation({
    onSuccess: (template) => {
      utils.reportTemplates.list.invalidate();
      toast.success(t("saveTemplate.saved"));
      onSaved(template.id);
      setName("");
      setDescription("");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[calc(100vw-2rem)] max-w-96 rounded-xl border border-gray-200/80 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <h2
          id="save-template-title"
          className="text-lg font-semibold text-gray-900 dark:text-white"
        >
          {t("saveTemplate.title")}
        </h2>
        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="save-template-name"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              {t("saveTemplate.name")}
            </label>
            <input
              id="save-template-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
            />
          </div>
          <div>
            <label
              htmlFor="save-template-description"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              {t("saveTemplate.description")}
            </label>
            <textarea
              id="save-template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            disabled={!name || create.isPending}
            onClick={() =>
              create.mutate({
                name,
                description: description || undefined,
                config,
              })
            }
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            {tc("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
