"use client";

import { Tags, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

interface BulkProjectActivityTypesBarProps {
  projectIds: string[];
  onClear: () => void;
}

/**
 * Enterprise (#475): sæt "Tilladte aktiviteter" på flere projekter ad gangen
 * fra projektlisten. Ingen valgte aktiviteter = alle org'ens aktive typer.
 */
export function BulkProjectActivityTypesBar({
  projectIds,
  onClear,
}: BulkProjectActivityTypesBarProps) {
  const t = useTranslations("projects");
  const utils = trpc.useUtils();
  const { data: types } = trpc.enterprise.listActivityTypes.useQuery();
  const [selected, setSelected] = useState<string[]>([]);

  const save = trpc.enterprise.setProjectActivityTypesBulk.useMutation({
    onSuccess: (res) => {
      utils.enterprise.listProjectActivityTypes.invalidate();
      utils.enterprise.getTimesheetWeek.invalidate();
      toast.success(
        res.count === 0
          ? t("bulkActivityTypes.savedAll", { projects: res.projects })
          : t("bulkActivityTypes.saved", {
              count: res.count,
              projects: res.projects,
            }),
      );
      onClear();
    },
    onError: (e) => toast.error(e.message || t("bulkActivityTypes.saveFailed")),
  });

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-sm dark:border-brand-600 dark:bg-tt-gran-lys">
      <span className="inline-flex items-center gap-2 font-medium text-gray-900 dark:text-white">
        <Tags className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        {t("bulkActivityTypes.selected", { count: projectIds.length })}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {types?.map((type) => {
          const checked = selected.includes(type.id);
          return (
            <label
              key={type.id}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                checked
                  ? "border-brand-500 bg-white text-brand-800 dark:bg-tt-gran-lys dark:text-brand-200"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(type.id)}
              />
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: type.color }}
                aria-hidden="true"
              />
              {type.name}
            </label>
          );
        })}
        {types && types.length === 0 && (
          <span className="text-xs text-gray-500">
            {t("bulkActivityTypes.noTypes")}
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {selected.length === 0
            ? t("bulkActivityTypes.allAllowed")
            : t("bulkActivityTypes.selectedN", { count: selected.length })}
        </span>
        <button
          type="button"
          disabled={save.isPending || projectIds.length === 0}
          onClick={() => save.mutate({ projectIds, activityTypeIds: selected })}
          className="rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
        >
          {save.isPending
            ? t("bulkActivityTypes.saving")
            : t("bulkActivityTypes.saveOnSelected")}
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={t("bulkActivityTypes.clear")}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
