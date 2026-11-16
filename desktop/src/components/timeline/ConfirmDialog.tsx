import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { formatDuration, formatTime } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import { confirmActivityAsTimeEntry } from "@/lib/timeEntryActions";
import type { Activity, Project } from "@/lib/types";
import { ACTIVITY_CATEGORIES } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  activity: Activity | null;
  projects: Project[];
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirmed,
  activity,
  projects,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form when dialog opens
  useEffect(() => {
    if (!open || !activity) return;
    setProjectId(activity.project_id);
    setCategory(activity.category ?? "");
    setError(null);
    setProjectDropdownOpen(false);
    setCategoryDropdownOpen(false);
  }, [open, activity]);

  const selectedProject = projects.find((p) => p.id === projectId);

  async function handleConfirm() {
    if (!activity) return;
    setSaving(true);
    setError(null);

    try {
      // The classification and the entry belong together, and the operation
      // holds its own lock, so a double click cannot bill the activity twice.
      const confirmed = await confirmActivityAsTimeEntry({
        activity,
        projectId,
        // Only meaningful when NO project is picked, where the activity's own
        // customer is what says who the meeting was with. Sending it alongside a
        // project looked like it could win; it cannot, and passing the project's
        // own instead is what the other forms do.
        clientId: projectId ? null : activity.client_id,
        category: category || null,
        projects,
      });
      if (!confirmed) return;

      toast.success(t("timeline.activityConfirmed"));
      onConfirmed();
    } catch (err) {
      console.error("Failed to confirm classification:", err);
      setError(t("timeline.couldNotConfirm"));
    } finally {
      setSaving(false);
    }
  }

  async function handleIgnore() {
    onClose();
  }

  async function handleDelete() {
    if (!activity) return;
    setSaving(true);
    setError(null);

    try {
      await tauriInvoke("delete_activity", {
        activityId: activity.id,
      });
      toast.success(t("timeline.activityDeleted"));
      onConfirmed();
    } catch (err) {
      console.error("Failed to delete activity:", err);
      setError(t("timeline.couldNotDelete"));
    } finally {
      setSaving(false);
    }
  }

  if (!activity) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("timeline.confirmActivity")}
      footer={
        <div className="flex w-full items-center justify-between">
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={saving}
          >
            {t("common.delete")}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleIgnore}>
              {t("timeline.ignore")}
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={saving}>
              {saving ? t("common.saving") : t("timeline.confirm")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Activity info */}
        <div className="rounded-lg border border-(--color-border) bg-(--color-bg) p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-(--color-text)">
              {activity.app_name}
            </span>
            <span className="font-mono text-sm text-(--color-text-muted)">
              {formatDuration(activity.duration)}
            </span>
          </div>
          {activity.window_title && (
            <p className="text-xs text-(--color-text-muted) line-clamp-2">
              {activity.window_title}
            </p>
          )}
          <p className="font-mono text-xs text-(--color-text-muted)">
            {formatTime(activity.started_at)} &ndash;{" "}
            {formatTime(activity.ended_at)}
          </p>
          {activity.confidence !== null && (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] text-(--color-text-muted)">
                {t("timeline.aiConfidence")}:
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                  activity.confidence > 0.85
                    ? "bg-emerald-500/15 text-emerald-400"
                    : activity.confidence > 0.5
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-red-500/15 text-red-400"
                }`}
              >
                {Math.round(activity.confidence * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Project selector */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-(--color-text-muted)">
            {t("timeEntry.project")}
          </span>
          <div className="relative">
            <button
              type="button"
              aria-label={t("common.selectProject")}
              onClick={() => {
                setProjectDropdownOpen(!projectDropdownOpen);
                setCategoryDropdownOpen(false);
              }}
              className="flex h-9 w-full items-center justify-between rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm transition-colors hover:border-(--color-text-muted)"
            >
              <div className="flex items-center gap-2">
                {selectedProject?.color && (
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: selectedProject.color }}
                  />
                )}
                <span
                  className={
                    selectedProject
                      ? "text-(--color-text)"
                      : "text-(--color-text-muted)"
                  }
                >
                  {selectedProject
                    ? selectedProject.name
                    : t("common.selectProject")}
                </span>
              </div>
              <ChevronDown
                size={14}
                className={`text-(--color-text-muted) transition-transform ${projectDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {projectDropdownOpen && (
              <div className="absolute top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setProjectId(null);
                    setProjectDropdownOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-(--color-text-muted) hover:bg-(--color-border)"
                >
                  {t("common.noProject")}
                </button>
                {projects
                  .filter((p) => !p.is_archived)
                  .map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => {
                        setProjectId(project.id);
                        setProjectDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--color-border) ${
                        projectId === project.id ? "bg-(--color-border)" : ""
                      }`}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: project.color ?? "#6b7280",
                        }}
                      />
                      <span className="text-(--color-text)">
                        {project.name}
                      </span>
                      {project.client_name && (
                        <span className="text-xs text-(--color-text-muted)">
                          ({project.client_name})
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Category selector */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-(--color-text-muted)">
            {t("timeline.category")}
          </span>
          <div className="relative">
            <button
              type="button"
              aria-label={t("timeline.selectCategory")}
              onClick={() => {
                setCategoryDropdownOpen(!categoryDropdownOpen);
                setProjectDropdownOpen(false);
              }}
              className="flex h-9 w-full items-center justify-between rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm transition-colors hover:border-(--color-text-muted)"
            >
              <span
                className={
                  category ? "text-(--color-text)" : "text-(--color-text-muted)"
                }
              >
                {category
                  ? t(`categories.${category}`, { defaultValue: category })
                  : t("timeline.selectCategory")}
              </span>
              <ChevronDown
                size={14}
                className={`text-(--color-text-muted) transition-transform ${categoryDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {categoryDropdownOpen && (
              <div className="absolute top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
                {ACTIVITY_CATEGORIES.map((cat) => (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => {
                      setCategory(cat);
                      setCategoryDropdownOpen(false);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-(--color-border) ${
                      category === cat ? "bg-(--color-border)" : ""
                    }`}
                  >
                    <span className="text-(--color-text)">
                      {t(`categories.${cat}`)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
