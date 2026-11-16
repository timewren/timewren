// src/app/dashboard/reports/_components/TemplateBar.tsx
"use client";
import { ChevronDown, Copy, Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";

interface TemplateBarProps {
  activeTemplateId: string | null;
  activeConfig: ReportTemplateConfig;
  isDirty: boolean;
  onSelect: (id: string, config: ReportTemplateConfig) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNew: () => void;
}

export function TemplateBar(props: TemplateBarProps) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const { data: templates } = trpc.reportTemplates.list.useQuery();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const deleteMutation = trpc.reportTemplates.delete.useMutation({
    onSuccess: () => {
      utils.reportTemplates.list.invalidate();
      toast.success(t("templateBar.deleted"));
      const remaining = templates?.filter(
        (tpl) => tpl.id !== props.activeTemplateId,
      );
      if (remaining?.[0]) {
        props.onSelect(
          remaining[0].id,
          remaining[0].config as ReportTemplateConfig,
        );
      }
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const { system, mine } = useMemo(() => {
    const sys = (templates ?? []).filter((t) => t.isSystem);
    const custom = (templates ?? []).filter((t) => !t.isSystem);
    return { system: sys, mine: custom };
  }, [templates]);

  const active = templates?.find((t) => t.id === props.activeTemplateId);

  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200/80 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("templateBar.chooseAria")}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <span className="max-w-[200px] truncate">
            {active?.name ?? t("templateBar.choose")}
          </span>
          {props.isDirty && (
            <span
              role="img"
              className="h-1.5 w-1.5 rounded-full bg-orange-500"
              aria-label={t("templateBar.unsaved")}
            />
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full z-10 mt-1 w-72 rounded-xl border border-gray-200/80 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900"
          >
            {system.length > 0 && (
              <div className="p-2">
                <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("templateBar.system")}
                </p>
                {system.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      props.onSelect(t.id, t.config as ReportTemplateConfig);
                      setOpen(false);
                    }}
                    className={`flex w-full flex-col rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                      t.id === props.activeTemplateId
                        ? "bg-gray-100 dark:bg-gray-800"
                        : ""
                    }`}
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-200">
                      {t.name}
                    </span>
                    {t.description && (
                      <span className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {t.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {mine.length > 0 && (
              <div className="border-t border-gray-200/80 p-2 dark:border-gray-800">
                <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("templateBar.mine")}
                </p>
                {mine.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      props.onSelect(t.id, t.config as ReportTemplateConfig);
                      setOpen(false);
                    }}
                    className={`flex w-full flex-col rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                      t.id === props.activeTemplateId
                        ? "bg-gray-100 dark:bg-gray-800"
                        : ""
                    }`}
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-200">
                      {t.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mx-auto" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.isDirty || active?.isSystem}
          title={
            active?.isSystem
              ? t("templateBar.systemLocked")
              : t("templateBar.saveChanges")
          }
          aria-label={t("templateBar.saveAria")}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-40 dark:text-brand-400 dark:hover:bg-tt-gran-lys"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{tc("save")}</span>
        </button>
        <button
          type="button"
          onClick={props.onSaveAs}
          aria-label={t("templateBar.saveAsAria")}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("templateBar.saveAs")}</span>
        </button>
        {active && !active.isSystem && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            aria-label={t("templateBar.deleteAria")}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tc("delete")}</span>
          </button>
        )}
        <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <button
          type="button"
          onClick={props.onNew}
          aria-label={t("templateBar.newAria")}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("templateBar.new")}</span>
        </button>
      </div>

      {active && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => {
            deleteMutation.mutate({ id: active.id });
            setShowDeleteConfirm(false);
          }}
          title={t("templateBar.deleteTitle")}
          description={t("templateBar.deleteConfirm", { name: active.name })}
          confirmLabel={tc("delete")}
          variant="danger"
          isLoading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
