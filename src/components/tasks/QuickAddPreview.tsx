"use client";

import { Calendar, Check, Clock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { toLocalDateStr } from "@/lib/format";

type Priority = "low" | "medium" | "high" | "urgent";

interface ParsedData {
  title: string;
  deadline: Date | null;
  priority: Priority;
  estimatedMinutes: number | null;
}

interface QuickAddPreviewProps {
  parsed: ParsedData;
  projects?: { id: string; name: string; clientId?: string | null }[];
  clients?: { id: string; name: string }[];
  defaultProjectId?: string | null;
  defaultClientId?: string | null;
  onConfirm: (data: {
    title: string;
    deadline: Date | null;
    priority: Priority;
    estimatedMinutes: number | null;
    projectId: string | null;
    clientId: string | null;
  }) => void;
  onCancel: () => void;
  /** Opretter mutationen — deaktiverer Opret-knap og Enter mod dobbeltklik */
  isPending?: boolean;
}

const priorityOptions: { value: Priority; labelKey: string; color: string }[] =
  [
    {
      value: "low",
      labelKey: "priority.low",
      color: "text-gray-600 bg-gray-100",
    },
    {
      value: "medium",
      labelKey: "quickAdd.priorityMedium",
      color: "text-brand-600 dark:text-brand-400 bg-brand-100",
    },
    {
      value: "high",
      labelKey: "priority.high",
      color: "text-orange-600 bg-orange-100",
    },
    {
      value: "urgent",
      labelKey: "priority.urgent",
      color: "text-red-600 bg-red-100",
    },
  ];

export function QuickAddPreview({
  parsed,
  projects,
  clients,
  defaultProjectId,
  defaultClientId,
  onConfirm,
  onCancel,
  isPending = false,
}: QuickAddPreviewProps) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [title, setTitle] = useState(parsed.title);
  const [deadline, setDeadline] = useState<string>(
    parsed.deadline ? toLocalDateStr(parsed.deadline) : "",
  );
  const [priority, setPriority] = useState<Priority>(parsed.priority);
  // Estimat i timer som tekst, så "1,5" kan skrives med dansk komma
  const [estimateHours, setEstimateHours] = useState<string>(
    parsed.estimatedMinutes
      ? String(Math.round((parsed.estimatedMinutes / 60) * 100) / 100).replace(
          ".",
          ",",
        )
      : "",
  );
  const [projectId, setProjectId] = useState<string>(defaultProjectId || "");
  const [clientId, setClientId] = useState<string>(defaultClientId || "");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (!title.trim() || isPending) return;
    const hours = Number.parseFloat(estimateHours.replace(",", "."));
    const estimatedMinutes =
      Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null;
    onConfirm({
      title: title.trim(),
      deadline: deadline ? new Date(deadline) : null,
      priority,
      estimatedMinutes,
      projectId: projectId || null,
      clientId: clientId || null,
    });
  };

  const cyclePriority = () => {
    const idx = priorityOptions.findIndex((p) => p.value === priority);
    const next = priorityOptions[(idx + 1) % priorityOptions.length];
    setPriority(next.value);
  };

  const currentPriority =
    priorityOptions.find((p) => p.value === priority) ?? priorityOptions[0];

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-600 dark:bg-tt-gran-lys">
      <div className="space-y-3">
        {/* Title */}
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          placeholder={t("quickAdd.titlePlaceholder")}
        />

        {/* Inline fields row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Priority badge - clickable */}
          <button
            type="button"
            onClick={cyclePriority}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${currentPriority.color}`}
            title={t("quickAdd.cyclePriority")}
          >
            {t(currentPriority.labelKey)}
          </button>

          {/* Deadline */}
          <div className="relative flex items-center">
            <Calendar className="absolute left-2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="rounded-md border border-gray-300 bg-white py-1 pl-7 pr-2 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            />
          </div>

          {/* Estimat (#212) — forudfyldt fra fx "~4t" i teksten */}
          <label className="relative flex items-center">
            <span className="sr-only">{t("quickAdd.estimateHours")}</span>
            <Clock
              className="absolute left-2 h-3.5 w-3.5 text-gray-400 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              inputMode="decimal"
              value={estimateHours}
              onChange={(e) =>
                setEstimateHours(e.target.value.replace(/[^\d.,]/g, ""))
              }
              onKeyDown={handleKeyDown}
              placeholder={t("quickAdd.estimatePlaceholder")}
              className="w-24 rounded-md border border-gray-300 bg-white py-1 pl-7 pr-5 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            />
            <span
              className="absolute right-2 text-xs text-gray-500 pointer-events-none dark:text-gray-400"
              aria-hidden="true"
            >
              {t("quickAdd.hourUnit")}
            </span>
          </label>

          {/* Project */}
          <ProjectSelect
            projects={projects?.map((p) => ({
              ...p,
              clientId: p.clientId ?? "",
            }))}
            value={projectId || null}
            onChange={(v) => {
              setProjectId(v ?? "");
              // Auto-set client from project
              const proj = projects?.find((p) => p.id === v);
              if (proj?.clientId) {
                setClientId(proj.clientId);
              }
            }}
            placeholder={t("quickAdd.noProject")}
            className="rounded-md border border-gray-300 bg-white py-1 pl-2 pr-6 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          />

          {/* Client */}
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={!!projectId}
            className="rounded-md border border-gray-300 bg-white py-1 pl-2 pr-6 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value="">{t("quickAdd.noClient")}</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!title.trim() || isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-tt-gran px-3 py-1.5 text-xs font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {isPending ? t("quickAdd.creating") : t("quickAdd.create")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
          >
            <X className="h-3.5 w-3.5" />
            {tc("cancel")}
          </button>
          <span className="text-xs text-gray-400">
            {t("quickAdd.enterToCreate")}
          </span>
        </div>
      </div>
    </div>
  );
}
