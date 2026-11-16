"use client";

import {
  CheckCircle2,
  Clock,
  Lightbulb,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

interface TimeSuggestion {
  id: string;
  type: "pattern" | "gap" | "reminder";
  projectId?: string;
  projectName?: string;
  clientId?: string;
  clientName?: string;
  description: string;
  suggestedHours: number;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export function AITimeSuggestions() {
  const t = useTranslations("time");
  const formatHours = useCallback(
    (hours: number): string => {
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      if (h === 0) return t("duration.m", { m });
      if (m === 0) return t("duration.h", { h });
      return t("duration.hm", { h, m });
    },
    [t],
  );
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    new Set(),
  );
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(
    new Set(),
  );

  const utils = trpc.useUtils();

  // Fetch recent time entries for pattern analysis
  const { data: recentEntriesData, isLoading } = trpc.time.list.useQuery({
    limit: 100,
  });

  const createMutation = trpc.time.create.useMutation({
    onSuccess: () => {
      toast.success(t("suggestions.created"));
      utils.time.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("suggestions.createFailed"));
    },
  });

  // Analyze patterns and generate suggestions
  const suggestions = useMemo<TimeSuggestion[]>(() => {
    if (!recentEntriesData?.entries || recentEntriesData.entries.length < 5) {
      return [];
    }

    // Normalize Drizzle relation types (T | T[] -> T)
    const entries = recentEntriesData.entries.map((entry) => {
      const project = entry.project
        ? Array.isArray(entry.project)
          ? entry.project[0]
          : entry.project
        : null;
      const client = entry.client
        ? Array.isArray(entry.client)
          ? entry.client[0]
          : entry.client
        : null;
      return {
        ...entry,
        project: project
          ? {
              ...project,
              client: project.client
                ? Array.isArray(project.client)
                  ? project.client[0]
                  : project.client
                : null,
            }
          : null,
        client,
      };
    });
    const result: TimeSuggestion[] = [];
    const today = new Date();
    const todayWeekday = today.getDay();
    const todayStr = toLocalDateStr(today);

    // 1. Analyze project patterns by weekday
    const patternsByWeekday: Record<
      number,
      Map<
        string,
        {
          count: number;
          totalHours: number;
          projectName: string;
          projectId: string;
          clientName?: string;
          clientId?: string;
        }
      >
    > = {};

    for (const entry of entries) {
      const entryDate = new Date(entry.date);
      const weekday = entryDate.getDay();
      const projectKey = entry.projectId || entry.clientId || "unknown";

      if (!patternsByWeekday[weekday]) {
        patternsByWeekday[weekday] = new Map();
      }

      const existing = patternsByWeekday[weekday].get(projectKey) || {
        count: 0,
        totalHours: 0,
        projectName: entry.project?.name || t("suggestions.unknown"),
        projectId: entry.projectId || "",
        clientName: entry.project?.client?.name || entry.client?.name,
        clientId: entry.clientId || entry.project?.clientId || "",
      };

      existing.count++;
      existing.totalHours += parseFloat(entry.hours || "0");
      patternsByWeekday[weekday].set(projectKey, existing);
    }

    // Check if there's a strong pattern for today
    const todayPatterns = patternsByWeekday[todayWeekday];
    if (todayPatterns) {
      for (const [projectKey, data] of todayPatterns) {
        // Only suggest if pattern is strong (at least 3 occurrences)
        if (data.count >= 3) {
          const avgHours = Math.round((data.totalHours / data.count) * 4) / 4; // Round to nearest 15 min

          // Check if there's already an entry today for this project
          const hasEntryToday = entries.some((e) => {
            const entryDateStr = toLocalDateStr(new Date(e.date));
            return (
              entryDateStr === todayStr &&
              (e.projectId === data.projectId || e.clientId === data.clientId)
            );
          });

          if (!hasEntryToday && avgHours > 0) {
            result.push({
              id: `pattern-${projectKey}`,
              type: "pattern",
              projectId: data.projectId || undefined,
              projectName: data.projectName,
              clientId: data.clientId || undefined,
              clientName: data.clientName,
              description: t("suggestions.workOn", {
                project: data.projectName,
              }),
              suggestedHours: avgHours,
              reason: t("suggestions.patternReason", {
                project: data.projectName,
                weekday: t(`suggestions.weekdayOn.${todayWeekday}`),
                count: data.count,
                hours: formatHours(avgHours),
              }),
              confidence:
                data.count >= 5 ? "high" : data.count >= 4 ? "medium" : "low",
            });
          }
        }
      }
    }

    // 2. Check for tracking gaps (no entries today)
    const entriesToday = entries.filter((e) => {
      const entryDateStr = toLocalDateStr(new Date(e.date));
      return entryDateStr === todayStr;
    });

    if (entriesToday.length === 0 && today.getHours() >= 10) {
      // Find most common project overall
      const projectCounts = new Map<
        string,
        {
          count: number;
          projectName: string;
          projectId: string;
          clientName?: string;
          clientId?: string;
        }
      >();

      for (const entry of entries) {
        const projectKey = entry.projectId || entry.clientId || "unknown";
        const existing = projectCounts.get(projectKey) || {
          count: 0,
          projectName: entry.project?.name || t("suggestions.unknown"),
          projectId: entry.projectId || "",
          clientName: entry.project?.client?.name || entry.client?.name,
          clientId: entry.clientId || entry.project?.clientId || "",
        };
        existing.count++;
        projectCounts.set(projectKey, existing);
      }

      // Get most frequent project
      let topProject: {
        projectName: string;
        projectId: string;
        clientName?: string;
        clientId?: string;
      } | null = null;
      let topCount = 0;

      for (const [_, data] of projectCounts) {
        if (data.count > topCount) {
          topCount = data.count;
          topProject = data;
        }
      }

      if (topProject) {
        result.push({
          id: "gap-today",
          type: "gap",
          projectId: topProject.projectId || undefined,
          projectName: topProject.projectName,
          clientId: topProject.clientId || undefined,
          clientName: topProject.clientName,
          description: t("suggestions.startTracking"),
          suggestedHours: 1,
          reason: t("suggestions.gapReason"),
          confidence: "medium",
        });
      }
    }

    return result;
  }, [recentEntriesData, t, formatHours]);

  const visibleSuggestions = suggestions.filter(
    (s) => !dismissedSuggestions.has(s.id) && !acceptedSuggestions.has(s.id),
  );

  const handleAccept = async (suggestion: TimeSuggestion) => {
    const today = toLocalDateStr(new Date());

    try {
      await createMutation.mutateAsync({
        projectId: suggestion.projectId,
        clientId: suggestion.clientId,
        description: suggestion.description,
        hours: suggestion.suggestedHours,
        date: today,
      });
      setAcceptedSuggestions((prev) => new Set(prev).add(suggestion.id));
    } catch (_error) {
      // Error is handled by mutation
    }
  };

  const handleDismiss = (suggestionId: string) => {
    setDismissedSuggestions((prev) => new Set(prev).add(suggestionId));
  };

  if (isLoading) {
    return null;
  }

  if (visibleSuggestions.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        <h3 className="font-semibold text-brand-900 dark:text-brand-100">
          {t("suggestions.title")}
        </h3>
        <span className="text-xs text-brand-600 dark:text-brand-400">
          {t("suggestions.basedOn")}
        </span>
      </div>

      <div className="space-y-2">
        {visibleSuggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className="flex items-start gap-3 rounded-lg bg-white dark:bg-gray-800 p-3 shadow-sm"
          >
            <div className="flex-shrink-0 mt-0.5">
              {suggestion.type === "pattern" ? (
                <Lightbulb className="h-5 w-5 text-amber-500" />
              ) : suggestion.type === "gap" ? (
                <Clock className="h-5 w-5 text-brand-500 dark:text-brand-400" />
              ) : (
                <Lightbulb className="h-5 w-5 text-brand-500 dark:text-brand-400" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 dark:text-white">
                  {suggestion.projectName}
                </span>
                {suggestion.clientName && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({suggestion.clientName})
                  </span>
                )}
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    suggestion.confidence === "high"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : suggestion.confidence === "medium"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400"
                  }`}
                >
                  {suggestion.confidence === "high"
                    ? t("suggestions.high")
                    : suggestion.confidence === "medium"
                      ? t("suggestions.medium")
                      : t("suggestions.low")}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                {suggestion.reason}
              </p>
              <div className="flex items-center gap-1 mt-1.5">
                <Clock className="h-3 w-3 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("suggestions.suggested", {
                    hours: formatHours(suggestion.suggestedHours),
                  })}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleAccept(suggestion)}
                disabled={createMutation.isPending}
                className="inline-flex items-center justify-center rounded-lg p-2 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                title={t("suggestions.accept")}
              >
                {createMutation.isPending ? (
                  <div className="h-4 w-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(suggestion.id)}
                className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title={t("suggestions.dismiss")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {acceptedSuggestions.size > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            {t("suggestions.accepted", { count: acceptedSuggestions.size })}
          </span>
        </div>
      )}
    </div>
  );
}
