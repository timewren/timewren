"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { LANE_CATEGORIES, type LaneCategory } from "@/lib/kanban/lane-category";
import { trpc } from "@/providers/trpc-provider";
import { LANE_COLORS } from "./lane-colors";

interface AddLaneModalProps {
  projectId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddLaneModal({
  projectId,
  isOpen,
  onClose,
  onSuccess,
}: AddLaneModalProps) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LANE_COLORS[0].value);
  const [category, setCategory] = useState<LaneCategory>("not_started");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const createLane = trpc.taskStatuses.create.useMutation({
    onSuccess: () => {
      toast.success(t("addLane.created"));
      onSuccess();
      onClose();
      setName("");
      setColor(LANE_COLORS[0].value);
      setCategory("not_started");
    },
    onError: (err) => toast.error(err.message || t("addLane.createFailed")),
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-lane-title"
        className="w-full max-w-sm rounded-lg bg-white dark:bg-gray-800 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <h2
            id="add-lane-title"
            className="text-base font-semibold text-gray-900 dark:text-white"
          >
            {t("addLane.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")}
            className="text-gray-400"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            createLane.mutate({
              projectId,
              name: name.trim(),
              color,
              category,
            });
          }}
          className="p-4 space-y-3"
        >
          <div>
            <label
              htmlFor="lane-name"
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("addLane.nameLabel")}
            </label>
            <input
              id="lane-name"
              type="text"
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              placeholder={t("addLane.namePlaceholder")}
            />
          </div>
          <div>
            <label
              htmlFor="lane-category"
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("addLane.categoryLabel")}
            </label>
            <select
              id="lane-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as LaneCategory)}
              aria-describedby="lane-category-hint"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              {LANE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`laneCategory.${c}`)}
                </option>
              ))}
            </select>
            <p
              id="lane-category-hint"
              className="mt-1 text-xs text-gray-500 dark:text-gray-400"
            >
              {t("addLane.categoryHint")}
            </p>
          </div>
          <fieldset>
            <legend className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("addLane.colorLabel")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {LANE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  aria-pressed={color === c.value}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    color === c.value
                      ? "border-gray-900 dark:border-white"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c.value }}
                  aria-label={t(`laneColors.${c.id}`)}
                  title={t(`laneColors.${c.id}`)}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {tc("cancel")}
            </button>
            <button
              type="submit"
              disabled={createLane.isPending || !name.trim()}
              className="rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
            >
              {createLane.isPending
                ? t("addLane.creating")
                : t("addLane.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
