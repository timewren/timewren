"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { TagPicker } from "@/components/tags/TagPicker";
import { trpc } from "@/providers/trpc-provider";

interface BulkProjectTagsBarProps {
  projectIds: string[];
  onClear: () => void;
}

/**
 * Sæt tags på flere projekter ad gangen fra projektlisten. Med 100+ projekter
 * er ét-ad-gangen ikke realistisk, og tags er forudsætningen for at kunne
 * filtrere tidsforbrug pr. afdeling (kunde A 8/9-2026).
 *
 * "Tilføj" lægger de valgte tags oveni projektets eksisterende; "Erstat"
 * sætter præcis de valgte. Ingen af delene rører projekter der ikke er valgt.
 */
export function BulkProjectTagsBar({
  projectIds,
  onClear,
}: BulkProjectTagsBarProps) {
  const t = useTranslations("projects");
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"add" | "replace">("add");

  const save = trpc.tags.setForProjectsBulk.useMutation({
    onSuccess: (res) => {
      utils.projects.listWithStats.invalidate();
      utils.tags.list.invalidate();
      toast.success(t("bulkTags.updated", { count: res.count }));
      setSelected([]);
      onClear();
    },
    onError: (e) => toast.error(e.message || t("bulkTags.failed")),
  });

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("bulkTags.selected", { count: projectIds.length })}
        </span>
        <div className="flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
          {(["add", "replace"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {m === "add" ? t("bulkTags.add") : t("bulkTags.replace")}
            </button>
          ))}
        </div>
        <div className="min-w-[220px] flex-1">
          <TagPicker
            selectedTagIds={selected}
            onChange={setSelected}
            placeholder={t("bulkTags.placeholder")}
          />
        </div>
        <button
          type="button"
          disabled={
            projectIds.length === 0 ||
            save.isPending ||
            (mode === "add" && selected.length === 0)
          }
          onClick={() => save.mutate({ projectIds, tagIds: selected, mode })}
          className="rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
        >
          {save.isPending ? t("bulkTags.saving") : t("bulkTags.save")}
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={t("bulkTags.cancel")}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {mode === "replace" && selected.length === 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {t("bulkTags.replaceWarning")}
        </p>
      )}
    </div>
  );
}
