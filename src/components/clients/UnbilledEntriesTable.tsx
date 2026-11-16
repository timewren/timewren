"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Loader2,
  Minus,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency, formatTime } from "@/lib/format";

interface TimeEntry {
  id: string;
  date: Date | string;
  description: string | null;
  hours: string;
  billableRate: string | null;
  project?: {
    id: string;
    name: string;
  } | null;
  isBillable: boolean | null;
  isBilled: boolean | null;
  isPrepaid: boolean | null;
}

interface UnbilledEntriesTableProps {
  entries: TimeEntry[];
  onSelectionChange: (selectedIds: string[]) => void;
  selectedIds: string[];
  isLoading?: boolean;
}

interface GroupedEntries {
  projectId: string | null;
  projectName: string;
  entries: TimeEntry[];
  totalHours: number;
  totalValue: number;
}

export function UnbilledEntriesTable({
  entries,
  onSelectionChange,
  selectedIds,
  isLoading = false,
}: UnbilledEntriesTableProps) {
  const t = useTranslations("clients");
  const locale = useLocale();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(["null"]), // Expand "no project" by default
  );

  // Filter to only unbilled, billable, non-prepaid entries
  const unbilledEntries = useMemo(() => {
    return entries.filter(
      (entry) => entry.isBillable && !entry.isBilled && !entry.isPrepaid,
    );
  }, [entries]);

  // Group entries by project
  const groupedEntries = useMemo(() => {
    const groups = new Map<string | null, GroupedEntries>();

    for (const entry of unbilledEntries) {
      const projectId = entry.project?.id || null;
      const projectName = entry.project?.name || t("unbilled.noProject");

      let group = groups.get(projectId);
      if (!group) {
        group = {
          projectId,
          projectName,
          entries: [],
          totalHours: 0,
          totalValue: 0,
        };
        groups.set(projectId, group);
      }

      group.entries.push(entry);

      const hours = parseFloat(entry.hours || "0");
      const rate = parseFloat(entry.billableRate || "0");
      group.totalHours += hours;
      group.totalValue += hours * rate;
    }

    // Sort entries within each group by date (newest first)
    for (const group of groups.values()) {
      group.entries.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    }

    // Convert to array and sort by project name
    return Array.from(groups.values()).sort((a, b) =>
      a.projectName.localeCompare(b.projectName, locale),
    );
  }, [unbilledEntries, t, locale]);

  // Calculate totals for selected entries
  const selectedStats = useMemo(() => {
    const selectedEntries = unbilledEntries.filter((e) =>
      selectedIds.includes(e.id),
    );
    const totalHours = selectedEntries.reduce(
      (sum, e) => sum + parseFloat(e.hours || "0"),
      0,
    );
    const totalValue = selectedEntries.reduce((sum, e) => {
      const hours = parseFloat(e.hours || "0");
      const rate = parseFloat(e.billableRate || "0");
      return sum + hours * rate;
    }, 0);

    return {
      count: selectedEntries.length,
      totalHours,
      totalValue,
    };
  }, [selectedIds, unbilledEntries]);

  // Calculate overall totals
  const overallStats = useMemo(() => {
    const totalHours = unbilledEntries.reduce(
      (sum, e) => sum + parseFloat(e.hours || "0"),
      0,
    );
    const totalValue = unbilledEntries.reduce((sum, e) => {
      const hours = parseFloat(e.hours || "0");
      const rate = parseFloat(e.billableRate || "0");
      return sum + hours * rate;
    }, 0);

    return {
      count: unbilledEntries.length,
      totalHours,
      totalValue,
    };
  }, [unbilledEntries]);

  // Toggle individual entry selection
  const toggleEntry = (entryId: string) => {
    if (selectedIds.includes(entryId)) {
      onSelectionChange(selectedIds.filter((id) => id !== entryId));
    } else {
      onSelectionChange([...selectedIds, entryId]);
    }
  };

  // Toggle all entries in a project
  const toggleProject = (projectId: string | null) => {
    const group = groupedEntries.find((g) => g.projectId === projectId);
    if (!group) return;

    const projectEntryIds = group.entries.map((e) => e.id);
    const allSelected = projectEntryIds.every((id) => selectedIds.includes(id));

    if (allSelected) {
      // Deselect all in project
      onSelectionChange(
        selectedIds.filter((id) => !projectEntryIds.includes(id)),
      );
    } else {
      // Select all in project
      const newSelected = new Set([...selectedIds, ...projectEntryIds]);
      onSelectionChange(Array.from(newSelected));
    }
  };

  // Toggle all entries
  const toggleAll = () => {
    if (selectedIds.length === unbilledEntries.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(unbilledEntries.map((e) => e.id));
    }
  };

  // Toggle project expansion
  const toggleExpanded = (projectId: string | null) => {
    const key = String(projectId);
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedProjects(newExpanded);
  };

  // Check if project has any selected entries
  const getProjectSelectionState = (
    projectId: string | null,
  ): "none" | "some" | "all" => {
    const group = groupedEntries.find((g) => g.projectId === projectId);
    if (!group) return "none";

    const projectEntryIds = group.entries.map((e) => e.id);
    const selectedCount = projectEntryIds.filter((id) =>
      selectedIds.includes(id),
    ).length;

    if (selectedCount === 0) return "none";
    if (selectedCount === projectEntryIds.length) return "all";
    return "some";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  if (unbilledEntries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-12 text-center">
        <FileText className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" />
        <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
          {t("unbilled.emptyTitle")}
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("unbilled.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t("unbilled.unbilledLabel")}
            </div>
            <div className="font-semibold text-gray-900 dark:text-white">
              {formatTime(overallStats.totalHours)} ={" "}
              {formatCurrency(overallStats.totalValue)}
            </div>
          </div>
        </div>

        {/* Select all toggle */}
        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <div
            className={`flex h-4 w-4 items-center justify-center rounded border ${
              selectedIds.length === unbilledEntries.length
                ? "border-tt-gran bg-tt-gran"
                : selectedIds.length > 0
                  ? "border-brand-600 bg-brand-100 dark:bg-tt-gran-lys"
                  : "border-gray-300 dark:border-gray-600"
            }`}
          >
            {selectedIds.length === unbilledEntries.length ? (
              <Check className="h-3 w-3 text-tt-paa-gran" />
            ) : selectedIds.length > 0 ? (
              <Minus className="h-3 w-3 text-brand-600 dark:text-brand-400" />
            ) : null}
          </div>
          {t("unbilled.selectAll", { count: unbilledEntries.length })}
        </button>
      </div>

      {/* Grouped entries */}
      <div className="space-y-3">
        {groupedEntries.map((group) => {
          const isExpanded = expandedProjects.has(String(group.projectId));
          const selectionState = getProjectSelectionState(group.projectId);

          return (
            <div
              key={group.projectId || "null"}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
            >
              {/* Project header */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: række-klik er musegenvej; knapperne i rækken er tastaturvejen */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: række-klik er musegenvej; knapperne i rækken er tastaturvejen */}
              <div
                className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 cursor-pointer"
                onClick={() => toggleExpanded(group.projectId)}
              >
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProject(group.projectId);
                    }}
                    className={`flex h-5 w-5 items-center justify-center rounded border ${
                      selectionState === "all"
                        ? "border-tt-gran bg-tt-gran"
                        : selectionState === "some"
                          ? "border-brand-600 bg-brand-100 dark:bg-tt-gran-lys"
                          : "border-gray-300 dark:border-gray-600 hover:border-brand-400"
                    }`}
                  >
                    {selectionState === "all" ? (
                      <Check className="h-3.5 w-3.5 text-tt-paa-gran" />
                    ) : selectionState === "some" ? (
                      <Minus className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                    ) : null}
                  </button>

                  {/* Expand/collapse icon */}
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}

                  {/* Project name */}
                  <span className="font-medium text-gray-900 dark:text-white">
                    {group.projectName}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {t("unbilled.entriesInGroup", {
                      count: group.entries.length,
                    })}
                  </span>
                </div>

                {/* Project totals */}
                <div className="flex items-center gap-2 sm:gap-4 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {formatTime(group.totalHours)}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatCurrency(group.totalValue)}
                  </span>
                </div>
              </div>

              {/* Entries list */}
              {isExpanded && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {group.entries.map((entry) => {
                    const isSelected = selectedIds.includes(entry.id);
                    const hours = parseFloat(entry.hours || "0");
                    const rate = parseFloat(entry.billableRate || "0");
                    const value = hours * rate;

                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: række-klik er musegenvej; knapperne i rækken er tastaturvejen
                      // biome-ignore lint/a11y/useKeyWithClickEvents: række-klik er musegenvej; knapperne i rækken er tastaturvejen
                      <div
                        key={entry.id}
                        onClick={() => toggleEntry(entry.id)}
                        className={`flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-brand-50 dark:bg-tt-gran-lys"
                            : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        }`}
                      >
                        {/* Checkbox */}
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded border flex-shrink-0 ${
                            isSelected
                              ? "border-tt-gran bg-tt-gran"
                              : "border-gray-300 dark:border-gray-600"
                          }`}
                        >
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 text-tt-paa-gran" />
                          )}
                        </div>

                        {/* Date */}
                        <div className="hidden sm:block w-20 flex-shrink-0 text-sm text-gray-500 dark:text-gray-400">
                          {new Date(entry.date).toLocaleDateString(
                            toIntlLocale(locale),
                            {
                              day: "numeric",
                              month: "short",
                            },
                          )}
                        </div>

                        {/* Description */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 dark:text-white truncate">
                            {entry.description || t("unbilled.noDescription")}
                          </p>
                        </div>

                        {/* Hours */}
                        <div className="w-14 sm:w-16 flex-shrink-0 text-right">
                          <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                            <Clock className="h-3.5 w-3.5" />
                            {formatTime(hours)}
                          </span>
                        </div>

                        {/* Value */}
                        <div className="w-20 sm:w-24 flex-shrink-0 text-right font-medium text-gray-900 dark:text-white text-sm">
                          {formatCurrency(value)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected summary */}
      {selectedStats.count > 0 && (
        <div className="sticky bottom-4 rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4 shadow-lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 dark:bg-tt-gran-lys">
                <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <span className="font-medium text-brand-900 dark:text-brand-100">
                  {t("unbilled.selectedCount", {
                    count: selectedStats.count,
                  })}
                </span>
                <span className="mx-2 text-brand-600 dark:text-brand-400">
                  •
                </span>
                <span className="text-brand-700 dark:text-brand-300">
                  {formatTime(selectedStats.totalHours)} ={" "}
                  {formatCurrency(selectedStats.totalValue)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
