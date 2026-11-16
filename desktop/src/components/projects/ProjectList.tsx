import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  Eye,
  EyeOff,
  FolderOpen,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadError";
import { useListKeyboard } from "@/hooks/useListKeyboard";
import { formatCurrency } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { OverBudgetProject, Project } from "@/lib/types";
import { toast } from "@/stores/toastStore";
import { ProjectForm } from "./ProjectForm";

export function ProjectList() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [overBudgetMap, setOverBudgetMap] = useState<
    Map<string, OverBudgetProject>
  >(new Map());

  const fetchProjects = useCallback(async () => {
    try {
      const result = await tauriInvoke<Project[]>("list_projects", {
        includeArchived: showArchived,
      });
      setProjects(result);
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
      setLoadFailed(true);
      setProjects([]);
    } finally {
      setLoading(false);
    }

    // Pynt, ikke indhold: budgetmærketingen står i samme blokke, men den må
    // ikke tage listen med ned, hvis *den* kaldet fejler. Dens egen fejl skal
    // heller ikke sætte listen i fejltilstand — projektlisten er brugbar uden.
    try {
      const overBudget = await tauriInvoke<OverBudgetProject[]>(
        "get_over_budget_projects",
      );
      const map = new Map<string, OverBudgetProject>();
      for (const ob of overBudget) {
        map.set(ob.id, ob);
      }
      setOverBudgetMap(map);
    } catch (err) {
      console.error("Failed to fetch over-budget projects:", err);
      setOverBudgetMap(new Map());
    }
  }, [showArchived]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.client_name?.toLowerCase().includes(q),
    );
  }, [projects, search]);

  // Keyboard navigation
  const keyboard = useListKeyboard({
    itemCount: filtered.length,
    enabled: !formOpen,
    onEdit: (index) => {
      const project = filtered[index];
      if (project) openEdit(project);
    },
    onSelect: (index) => {
      const project = filtered[index];
      if (project) openEdit(project);
    },
  });

  async function handleArchive(project: Project) {
    try {
      await tauriInvoke("archive_project", { id: project.id });
      toast.success(t("projects.projectArchived"));
      fetchProjects();
    } catch (err) {
      console.error("Failed to archive project:", err);
      toast.error(t("projects.couldNotArchiveProject"));
    }
  }

  function openCreate() {
    setEditingProject(null);
    setFormOpen(true);
  }

  function openEdit(project: Project) {
    setEditingProject(project);
    setFormOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
          />
          <input
            type="text"
            aria-label={t("projects.searchProjects")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("projects.searchProjects")}
            className="h-9 w-full rounded-md border border-(--color-border) bg-(--color-bg) pl-9 pr-3 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowArchived(!showArchived)}
          title={
            showArchived
              ? t("projects.hideArchived")
              : t("projects.showArchived")
          }
        >
          {showArchived ? <Eye size={14} /> : <EyeOff size={14} />}
          <span className="hidden sm:inline">
            {showArchived
              ? t("projects.hideArchived")
              : t("projects.showArchived")}
          </span>
        </Button>

        <Button size="sm" onClick={openCreate}>
          <Plus size={14} />
          {t("projects.newProject")}
        </Button>
      </div>

      {/* List */}
      {loadFailed ? (
        <LoadError
          message={t("projects.projectsLoadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchProjects();
          }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          hasProjects={projects.length > 0}
          onCreateClick={openCreate}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-(--color-border)">
          {/* Header */}
          <div className="grid grid-cols-[24px_1fr_1fr_100px_80px] gap-2 items-center border-b border-(--color-border) bg-(--color-bg) px-4 py-2.5">
            <span />
            <span className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider">
              {t("common.name")}
            </span>
            <span className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider">
              {t("projects.client")}
            </span>
            <span className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider text-right">
              {t("projects.hourlyRate")}
            </span>
            <span />
          </div>

          {/* Rows */}
          <AnimatePresence>
            {filtered.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={`grid grid-cols-[24px_1fr_1fr_100px_80px] gap-2 items-center border-b border-(--color-border) last:border-b-0 px-4 py-2.5 transition-colors hover:bg-(--color-border)/30 cursor-pointer group ${
                  project.is_archived ? "opacity-50" : ""
                } ${index === keyboard.activeIndex ? "ring-2 ring-(--color-accent)/50" : ""}`}
                onClick={() => openEdit(project)}
              >
                {/* Color dot */}
                <div className="flex items-center justify-center">
                  <div
                    className="h-3 w-3 rounded-full ring-1 ring-white/10"
                    style={{
                      backgroundColor: project.color || "#6B7280",
                    }}
                  />
                </div>

                <span className="text-sm font-medium text-(--color-text) truncate flex items-center gap-1.5">
                  {project.name}
                  {(() => {
                    const ob = overBudgetMap.get(project.id);
                    if (!ob) return null;
                    const isRed = ob.percentage >= 150;
                    return (
                      <span
                        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                          isRed
                            ? "bg-red-500/15 text-red-400"
                            : "bg-yellow-500/15 text-yellow-400"
                        }`}
                        title={`${Math.round(ob.used_hours * 10) / 10} ${t("common.hours")} / ${ob.estimated_hours} ${t("common.hours")} (${Math.round(ob.percentage)}%)`}
                      >
                        <AlertTriangle size={10} />
                        {Math.round(ob.percentage)}%
                      </span>
                    );
                  })()}
                </span>

                <span className="text-sm text-(--color-text-muted) truncate">
                  {project.client_name || "—"}
                </span>

                <span className="text-sm text-(--color-text) text-right font-mono">
                  {project.hourly_rate
                    ? formatCurrency(project.hourly_rate, 2)
                    : "—"}
                </span>

                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(project);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-(--color-text-muted) hover:bg-(--color-border) hover:text-(--color-text) transition-colors"
                    aria-label={`${t("common.edit")} ${project.name}`}
                    title={t("common.edit")}
                  >
                    <Pencil size={13} />
                  </button>
                  {!project.is_archived && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleArchive(project);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-(--color-text-muted) hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      aria-label={`${t("common.archive")} ${project.name}`}
                      title={t("common.archive")}
                    >
                      <Archive size={13} />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Keyboard hint */}
      {filtered.length > 0 && (
        <p className="text-center text-[10px] text-(--color-text-muted)/50">
          {t("keyboard.listHint")}
        </p>
      )}

      {/* Form dialog */}
      <ProjectForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchProjects}
        project={editingProject}
      />
    </div>
  );
}

function EmptyState({
  hasProjects,
  onCreateClick,
}: {
  hasProjects: boolean;
  onCreateClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-(--color-border)/40 mb-4">
        <FolderOpen size={22} className="text-(--color-text-muted)" />
      </div>
      <h3 className="text-sm font-medium text-(--color-text) mb-1">
        {hasProjects ? t("common.noResults") : t("projects.noProjects")}
      </h3>
      <p className="text-xs text-(--color-text-muted) mb-4 max-w-[240px]">
        {hasProjects
          ? t("projects.noResultsSearch")
          : t("projects.createFirstProject")}
      </p>
      {!hasProjects && (
        <Button size="sm" onClick={onCreateClick}>
          <Plus size={14} />
          {t("projects.newProject")}
        </Button>
      )}
    </div>
  );
}
