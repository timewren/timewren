"use client";

import { Mail, Shield, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

interface MarkIrrelevantDialogProps {
  taskId: string;
  taskTitle: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function MarkIrrelevantDialog({
  taskId,
  taskTitle,
  open,
  onClose,
  onSuccess,
}: MarkIrrelevantDialogProps) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const utils = trpc.useUtils();
  const [selectedRules, setSelectedRules] = useState<Set<number>>(new Set());

  const { data: suggestions, isLoading } =
    trpc.emailTasks.suggestFilters.useQuery({ taskId }, { enabled: open });

  const markMutation = trpc.emailTasks.markAsNotRelevant.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
      utils.emailTasks.getFilterRules.invalidate();
      toast.success(t("markIrrelevant.done"));
      onSuccess?.();
      onClose();
    },
    onError: (error) => {
      toast.error(error.message || t("markIrrelevant.failed"));
    },
  });

  if (!open) return null;

  const toggleRule = (index: number) => {
    const next = new Set(selectedRules);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedRules(next);
  };

  const handleSubmit = () => {
    if (!suggestions) return;

    const filterActions = Array.from(selectedRules).map((i) => ({
      ruleType: suggestions[i].ruleType,
      pattern: suggestions[i].pattern,
    }));

    markMutation.mutate({
      taskId,
      filterActions,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <Shield className="h-5 w-5 text-orange-500" />
            {t("markIrrelevant.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t("markIrrelevant.intro", { title: taskTitle })}
        </p>

        {isLoading ? (
          <div className="mt-4 flex justify-center py-4">
            <InlineSpinner className="h-6 w-6" />
          </div>
        ) : suggestions && suggestions.length > 0 ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-gray-500">
              {t("markIrrelevant.suggested")}
            </p>
            {suggestions.map((s, i) => (
              <label
                key={`${s.ruleType}-${s.pattern}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                <input
                  type="checkbox"
                  checked={selectedRules.has(i)}
                  onChange={() => toggleRule(i)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                <div className="flex-1">
                  <span className="text-sm text-gray-900 dark:text-white">
                    {s.label}
                  </span>
                  <span className="mt-0.5 block font-mono text-xs text-gray-500">
                    {s.pattern}
                  </span>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-700">
            <Mail className="h-4 w-4" />
            {t("markIrrelevant.noSuggestions")}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={markMutation.isPending}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {markMutation.isPending
              ? t("markIrrelevant.archiving")
              : selectedRules.size > 0
                ? t("markIrrelevant.archiveWithRules", {
                    count: selectedRules.size,
                  })
                : t("markIrrelevant.archiveNoRules")}
          </button>
        </div>
      </div>
    </div>
  );
}
