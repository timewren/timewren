"use client";

import { Check, Palette, Star, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useModules } from "@/hooks/useModules";
import { trpc } from "@/providers/trpc-provider";

interface CreateTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Pre-fill from current timer state
  defaultProjectId?: string | null;
  defaultClientId?: string | null;
  defaultDescription?: string;
}

const COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

export function CreateTemplateModal({
  isOpen,
  onClose,
  defaultProjectId,
  defaultClientId,
  defaultDescription,
}: CreateTemplateModalProps) {
  const t = useTranslations("timer");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  // Focus trap
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }, []);

  // Setup focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("keydown", handleTabKey);
      document.body.style.overflow = "hidden";

      // Focus name input
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleTabKey);
      document.body.style.overflow = "";

      if (!isOpen && previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, handleKeyDown, handleTabKey]);
  const [description, setDescription] = useState(defaultDescription || "");
  const [projectId, setProjectId] = useState<string | null>(
    defaultProjectId || null,
  );
  const [clientId, setClientId] = useState<string | null>(
    defaultClientId || null,
  );
  const [color, setColor] = useState(COLORS[0]);
  const [isFavorite, setIsFavorite] = useState(false);

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: isOpen && !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: isOpen && !modulesPlaceholder && isModuleEnabled("projects"),
  });

  const utils = trpc.useUtils();
  const createTemplate = trpc.timerTemplates.create.useMutation({
    onSuccess: () => {
      toast.success(t("createTemplate.created"));
      utils.timerTemplates.list.invalidate();
      handleClose();
    },
    onError: (error) => {
      toast.error(error.message || t("createTemplate.createFailed"));
    },
  });

  const handleClose = () => {
    setName("");
    setDescription(defaultDescription || "");
    setProjectId(defaultProjectId || null);
    setClientId(defaultClientId || null);
    setColor(COLORS[0]);
    setIsFavorite(false);
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error(t("createTemplate.nameRequired"));
      return;
    }

    if (!clientId && !projectId) {
      toast.error(t("createTemplate.clientOrProject"));
      return;
    }

    createTemplate.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      projectId: projectId || undefined,
      clientId: clientId || undefined,
      color,
      isFavorite,
    });
  };

  if (!isOpen) return null;

  // Filter projects by selected client
  const filteredProjects = clientId
    ? projects?.filter((p) => p.clientId === clientId)
    : projects;

  // Get client for selected project
  const selectedProject = projects?.find((p) => p.id === projectId);
  const effectiveClientId = projectId ? selectedProject?.clientId : clientId;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-template-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl mx-4 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3
            id="create-template-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {t("createTemplate.title")}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            aria-label={t("createTemplate.closeDialog")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="template-name"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("createTemplate.name")}
            </label>
            <input
              ref={nameInputRef}
              id="template-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 px-3 py-2 focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
              placeholder={t("createTemplate.namePlaceholder")}
            />
          </div>

          {/* Client */}
          <div>
            <label
              htmlFor="template-client"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("createTemplate.client")}
            </label>
            <select
              id="template-client"
              value={effectiveClientId || ""}
              onChange={(e) => {
                setClientId(e.target.value || null);
                setProjectId(null); // Reset project when client changes
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
            >
              <option value="">{t("createTemplate.selectClient")}</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div>
            <label
              htmlFor="template-project"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("createTemplate.project")}
            </label>
            <select
              id="template-project"
              value={projectId || ""}
              onChange={(e) => {
                const newProjectId = e.target.value || null;
                setProjectId(newProjectId);
                // Auto-set client from project
                if (newProjectId) {
                  const project = projects?.find((p) => p.id === newProjectId);
                  if (project) {
                    setClientId(project.clientId);
                  }
                }
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
              disabled={!effectiveClientId && !projectId}
            >
              <option value="">{t("createTemplate.noProject")}</option>
              {filteredProjects?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="template-description"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("createTemplate.description")}
            </label>
            <input
              id="template-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 px-3 py-2 focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
              placeholder={t("createTemplate.descriptionPlaceholder")}
            />
          </div>

          {/* Color */}
          <div>
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Palette className="h-4 w-4" aria-hidden="true" />
              {t("createTemplate.color")}
            </span>
            <div
              className="flex gap-2 flex-wrap"
              role="radiogroup"
              aria-label={t("createTemplate.pickColor")}
            >
              {COLORS.map((c) => (
                // biome-ignore lint/a11y/useSemanticElements: knapper brugt som radiogruppe med aria-checked; native radio kræver skjulte inputs og anden styling
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                    color === c
                      ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 scale-110"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                  role="radio"
                  aria-checked={color === c}
                  aria-label={t("createTemplate.colorOption", { color: c })}
                >
                  {color === c && (
                    <Check
                      className="h-4 w-4 text-white mx-auto"
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Favorite Toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isFavorite}
              onChange={(e) => setIsFavorite(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              aria-describedby="favorite-description"
            />
            <div className="flex items-center gap-2">
              <Star
                className={`h-4 w-4 ${isFavorite ? "text-yellow-500 fill-yellow-500" : "text-gray-400"}`}
                aria-hidden="true"
              />
              <span
                id="favorite-description"
                className="text-sm text-gray-700 dark:text-gray-300"
              >
                {t("createTemplate.addToFavorites")}
              </span>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="p-4 pt-0 flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={createTemplate.isPending}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createTemplate.isPending || !name.trim()}
            className="flex-1 rounded-lg bg-tt-gran hover:bg-tt-gran-moerk px-4 py-2.5 font-medium text-tt-paa-gran transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            {createTemplate.isPending
              ? t("createTemplate.creating")
              : t("createTemplate.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
