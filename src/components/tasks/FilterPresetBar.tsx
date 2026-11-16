"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useTaskPreferencesStore } from "@/stores/taskPreferencesStore";

export function FilterPresetBar() {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const {
    filterPresets,
    activePresetId,
    addFilterPreset,
    removeFilterPreset,
    applyFilterPreset,
    setActivePresetId,
  } = useTaskPreferencesStore();

  const [showNameInput, setShowNameInput] = useState(false);
  const [presetName, setPresetName] = useState("");

  const handleSave = () => {
    const name = presetName.trim();
    if (!name) return;
    addFilterPreset(name);
    setPresetName("");
    setShowNameInput(false);
  };

  if (filterPresets.length === 0 && !showNameInput) {
    return (
      <button
        type="button"
        onClick={() => setShowNameInput(true)}
        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <Plus className="h-3 w-3" />
        {t("filterPresets.saveFilter")}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {filterPresets.map((preset) => (
        <div
          key={preset.id}
          className={`group flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors ${
            activePresetId === preset.id
              ? "bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
              : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              if (activePresetId === preset.id) {
                setActivePresetId(null);
              } else {
                applyFilterPreset(preset.id);
              }
            }}
            className="truncate max-w-[120px]"
          >
            {preset.name}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeFilterPreset(preset.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-gray-300 dark:hover:bg-gray-500 transition-opacity"
            title={t("filterPresets.remove")}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}

      {showNameInput ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setShowNameInput(false);
                setPresetName("");
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: feltet vises som følge af brugerens handling (inline-redigering/dialog), så fokus flytter forventeligt
            autoFocus
            placeholder={t("filterPresets.namePlaceholder")}
            className="w-28 rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1 text-[11px] text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!presetName.trim()}
            className="rounded-full bg-tt-gran text-tt-paa-gran px-2 py-1 text-[10px] font-medium hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {tc("save")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNameInput(false);
              setPresetName("");
            }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNameInput(true)}
          className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title={t("filterPresets.saveCurrent")}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
