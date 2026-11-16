"use client";

import { Loader2, Plus, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { useModules } from "@/hooks/useModules";
import { parseTaskText } from "@/lib/task-parser";
import { parseEstimate } from "@/lib/tasks/time-progress";
import { trpc } from "@/providers/trpc-provider";
import { useTaskPreferencesStore } from "@/stores/taskPreferencesStore";
import { QuickAddPreview } from "./QuickAddPreview";

interface QuickAddTaskProps {
  projectId?: string | null;
  clientId?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  onSuccess?: () => void;
  className?: string;
}

export function QuickAddTask({
  projectId,
  clientId,
  placeholder,
  autoFocus = false,
  onSuccess,
  className = "",
}: QuickAddTaskProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("tasks");
  const placeholderText =
    placeholder ??
    t(
      brand.id === "timewren"
        ? "column.newTaskPlaceholder"
        : "quickAdd.placeholder",
    );
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [parsedText, setParsedText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { lastProjectId, lastClientId, setLastContext } =
    useTaskPreferencesStore();

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });

  const utils = trpc.useUtils();

  const createMutation = trpc.tasks.create.useMutation({
    onSuccess: (task) => {
      setValue("");
      setShowPreview(false);
      setParsedText("");
      toast.success(t("quickAdd.added"), {
        description: task.title,
      });
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.getStats.invalidate();
      // Remember context
      if (task.projectId || task.clientId) {
        setLastContext(task.projectId || null, task.clientId || null);
      }
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(t("quickAdd.createFailed"), {
        description: error.message,
      });
    },
  });

  // Focus input on mount if autoFocus
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedValue = value.trim();
    if (!trimmedValue) return;

    // Show preview instead of creating directly
    setParsedText(trimmedValue);
    setShowPreview(true);
  };

  const handlePreviewConfirm = (data: {
    title: string;
    deadline: Date | null;
    priority: "low" | "medium" | "high" | "urgent";
    estimatedMinutes: number | null;
    projectId: string | null;
    clientId: string | null;
  }) => {
    createMutation.mutate({
      title: data.title,
      deadline: data.deadline || undefined,
      priority: data.priority,
      estimatedMinutes: data.estimatedMinutes ?? undefined,
      projectId: data.projectId || undefined,
      clientId: data.clientId || undefined,
      status: "backlog",
    });
  };

  const handlePreviewCancel = () => {
    setShowPreview(false);
    setParsedText("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (showPreview) {
        handlePreviewCancel();
      } else {
        setValue("");
        inputRef.current?.blur();
      }
    }
  };

  // Detect hints in text for visual feedback
  const getHints = () => {
    const hints: string[] = [];
    const text = value.toLowerCase();

    // Deadline hints
    if (
      /i morgen|i overmorgen|om \d+ dag|inden (fredag|mandag|tirsdag|onsdag|torsdag|lørdag|søndag)/i.test(
        text,
      )
    ) {
      hints.push(t("quickAdd.hintDeadline"));
    }

    // Priority hints
    if (/haster|asap|vigtig|urgent|kritisk/i.test(text)) {
      hints.push(t("quickAdd.hintPriority"));
    }

    // Estimat-hint ("~4t", "30 min") — #212
    if (parseEstimate(value)) {
      hints.push(t("quickAdd.hintEstimate"));
    }

    return hints;
  };

  const hints = getHints();

  // Normalize projects for preview
  const normalizedProjects = projects?.map((p) => ({
    id: p.id,
    name: p.name,
    clientId: (p as { clientId?: string }).clientId || null,
  }));

  return (
    <div className={className}>
      {showPreview ? (
        <QuickAddPreview
          parsed={parseTaskText(parsedText)}
          projects={normalizedProjects}
          clients={clients}
          defaultProjectId={projectId || lastProjectId}
          defaultClientId={clientId || lastClientId}
          onConfirm={handlePreviewConfirm}
          onCancel={handlePreviewCancel}
          isPending={createMutation.isPending}
        />
      ) : (
        <form onSubmit={handleSubmit} className="relative">
          <div
            className={`
              flex items-center gap-2
              bg-white dark:bg-gray-800
              border rounded-lg
              transition-all duration-200
              ${
                isFocused
                  ? "border-brand-500 ring-2 ring-brand-500/20"
                  : "border-gray-300 dark:border-gray-600"
              }
            `}
          >
            <div className="pl-3">
              {createMutation.isPending ? (
                <Loader2 className="h-5 w-5 text-brand-500 dark:text-brand-400 animate-spin" />
              ) : (
                <Plus className="h-5 w-5 text-gray-400" />
              )}
            </div>

            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              disabled={createMutation.isPending}
              className="
                flex-1 py-3 pr-3
                bg-transparent
                text-gray-900 dark:text-white
                placeholder:text-gray-400 dark:placeholder:text-gray-500
                focus:outline-none
                disabled:opacity-50
              "
            />

            {/* Hint badges */}
            {hints.length > 0 && (
              <div className="flex items-center gap-1.5 pr-2">
                <Sparkles className="h-3.5 w-3.5 text-brand-500 dark:text-brand-400" />
                {hints.map((hint) => (
                  <span
                    key={hint}
                    className="text-xs px-1.5 py-0.5 rounded bg-brand-100 dark:bg-tt-gran-lys text-brand-600 dark:text-brand-400"
                  >
                    {hint}
                  </span>
                ))}
              </div>
            )}

            {value.trim() && (
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="
                  mr-2 px-3 py-1.5
                  bg-tt-gran hover:bg-tt-gran-moerk
                  text-tt-paa-gran text-sm font-medium
                  rounded-md
                  transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                {t("quickAdd.add")}
              </button>
            )}
          </div>

          {/* Help text */}
          {isFocused && !value && (
            <div className="absolute top-full left-0 right-0 mt-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                <Sparkles className="inline h-3 w-3 mr-1 text-brand-500 dark:text-brand-400" />
                {t("quickAdd.smartParsing")}
              </p>
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-900 dark:text-gray-200">
                    {t("quickAdd.helpDeadline")}
                  </span>{" "}
                  {t("quickAdd.exampleDeadline")}
                </div>
                <div className="text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-900 dark:text-gray-200">
                    {t("quickAdd.helpPriority")}
                  </span>{" "}
                  {t("quickAdd.examplePriority")}
                </div>
                <div className="text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-900 dark:text-gray-200">
                    {t("quickAdd.helpEstimate")}
                  </span>{" "}
                  {t("quickAdd.exampleEstimate")}
                </div>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
