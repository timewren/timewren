"use client";

import {
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  FolderKanban,
  Plus,
  RotateCcw,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { useFormDraft } from "@/hooks/useFormDraft";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

interface QuickEntryDraft {
  projectId: string;
  description: string;
  hours: string;
}

export function QuickActionsWidget() {
  const t = useTranslations("dashboard.widgets.quickActions");
  const [showQuickEntry, setShowQuickEntry] = useState(false);

  // Use draft hook for form persistence
  const {
    values: draftValues,
    setValues: setDraftValues,
    hasDraft,
    clearDraft,
    restoreDraft,
    isDraftRestored,
  } = useFormDraft<QuickEntryDraft>({
    key: "quick-time-entry",
    initialValues: { projectId: "", description: "", hours: "" },
  });

  const [quickEntryProjectId, setQuickEntryProjectId] = useState("");
  const [quickEntryDescription, setQuickEntryDescription] = useState("");
  const [quickEntryHours, setQuickEntryHours] = useState("");

  // Sync local state with draft
  useEffect(() => {
    if (isDraftRestored) {
      setQuickEntryProjectId(draftValues.projectId);
      setQuickEntryDescription(draftValues.description);
      setQuickEntryHours(draftValues.hours);
    }
  }, [isDraftRestored, draftValues]);

  // Update draft when local values change
  useEffect(() => {
    setDraftValues({
      projectId: quickEntryProjectId,
      description: quickEntryDescription,
      hours: quickEntryHours,
    });
  }, [
    quickEntryProjectId,
    quickEntryDescription,
    quickEntryHours,
    setDraftValues,
  ]);

  const { data: projects } = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();
  const createMutation = trpc.time.create.useMutation({
    onSuccess: () => {
      toast.success(t("created"));
      setQuickEntryProjectId("");
      setQuickEntryDescription("");
      setQuickEntryHours("");
      clearDraft(); // Clear draft on successful save
      setShowQuickEntry(false);
      utils.time.list.invalidate();
      utils.time.weeklyGoalProgress.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("createFailed"));
    },
  });

  const handleQuickEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const hours = parseFloat(quickEntryHours);
    if (
      !quickEntryProjectId ||
      !quickEntryDescription ||
      Number.isNaN(hours) ||
      hours <= 0
    ) {
      toast.error(t("fillAll"));
      return;
    }

    createMutation.mutate({
      projectId: quickEntryProjectId,
      description: quickEntryDescription,
      hours,
      date: toLocalDateStr(new Date()),
    });
  };

  const actions = [
    {
      href: "/dashboard/clients/new",
      icon: Users,
      label: t("addClient"),
      color: "text-tt-graa",
      iconBg: "bg-tt-flade",
    },
    {
      href: "/dashboard/projects/new",
      icon: FolderKanban,
      label: t("newProject"),
      color: "text-tt-graa",
      iconBg: "bg-tt-flade",
    },
    {
      href: "/dashboard/time",
      icon: Clock,
      label: t("startTimer"),
      color: "text-tt-graa",
      iconBg: "bg-tt-flade",
    },
    {
      href: "/dashboard/invoices/new",
      icon: FileText,
      label: t("createInvoice"),
      color: "text-tt-graa",
      iconBg: "bg-tt-flade",
    },
  ];

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Zap className="h-5 w-5 text-tt-graa" />}
    >
      <div className="space-y-4">
        {/* Quick Time Entry Toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQuickEntry(!showQuickEntry)}
            className="flex-1 flex items-center justify-between gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {t("quickEntry")}
              {hasDraft && !showQuickEntry && (
                <span
                  className="inline-flex h-2 w-2 rounded-full bg-amber-500"
                  title={t("draftSaved")}
                />
              )}
            </div>
            {showQuickEntry ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {hasDraft && !showQuickEntry && (
            <button
              type="button"
              onClick={() => {
                restoreDraft();
                setShowQuickEntry(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-3 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
              title={t("restoreDraft")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("restore")}
            </button>
          )}
        </div>

        {/* Quick Entry Form */}
        {showQuickEntry && (
          <form onSubmit={handleQuickEntry} className="space-y-3">
            <ProjectSelect
              projects={projects}
              value={quickEntryProjectId || null}
              onChange={(v) => setQuickEntryProjectId(v ?? "")}
              placeholder={t("projectPlaceholder")}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none"
            />

            <input
              type="text"
              value={quickEntryDescription}
              onChange={(e) => setQuickEntryDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:border-brand-500 focus:outline-none"
            />

            <div className="flex gap-2">
              <input
                type="number"
                step="0.25"
                min="0.01"
                value={quickEntryHours}
                onChange={(e) => setQuickEntryHours(e.target.value)}
                placeholder={t("hoursPlaceholder")}
                className="w-20 sm:w-24 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 sm:px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:border-brand-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1 rounded-xl bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {createMutation.isPending ? t("saving") : t("save")}
              </button>
            </div>
          </form>
        )}

        {/* Quick Action Links */}
        <div className="grid gap-2 sm:gap-3 grid-cols-2">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors p-3"
            >
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-xl ${action.iconBg}`}
              >
                <action.icon className={`h-5 w-5 ${action.color}`} />
              </div>
              <span className="text-xs font-medium text-center text-gray-700 dark:text-gray-300">
                {action.label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </DashboardWidget>
  );
}
