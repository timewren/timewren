import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { timeToHours } from "@/lib/calendar";
import { formatDuration } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Activity } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface GhostBlockProps {
  activity: Activity;
  /** All activity ids covered by this block (merged blocks confirm together). */
  activityIds?: number[];
  hourHeight: number;
  startHour: number;
  onConfirmed: () => void;
}

export function GhostBlock({
  activity,
  activityIds,
  hourHeight,
  startHour,
  onConfirmed,
}: GhostBlockProps) {
  const { t } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);
  // Kun mens dialogen står åben: blokken mountes én pr. aktivitet i tidslinjen,
  // så en hentning ved mount ville være en forespørgsel pr. blok.
  const { projects, loadFailed, retry } = useProjectClientPicker({
    active: showConfirm,
    clients: false,
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    activity.project_id,
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Escape-to-close for confirm popup
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setShowConfirm(false);
  }, []);

  useEffect(() => {
    if (showConfirm) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [showConfirm, handleKeyDown]);

  const style = useMemo(() => {
    const startH = timeToHours(activity.started_at);
    const endH = timeToHours(activity.ended_at);
    const top = (startH - startHour) * hourHeight;
    const height = Math.max((endH - startH) * hourHeight, 4);

    return {
      top: `${top}px`,
      height: `${height}px`,
      minHeight: "18px",
    };
  }, [activity, hourHeight, startHour]);

  const confidencePct = activity.confidence
    ? Math.round(activity.confidence * 100)
    : null;
  const isCompact = parseFloat(style.height) < 40;

  const ids = activityIds ?? [activity.id];

  async function confirmClassification(projectId: string) {
    if (ids.length > 1) {
      await tauriInvoke("bulk_confirm_classifications", {
        items: ids.map((id) => ({
          activity_id: id,
          project_id: projectId,
          category: activity.category,
        })),
      });
    } else {
      await tauriInvoke("confirm_classification", {
        activityId: activity.id,
        projectId,
        category: activity.category,
      });
    }
  }

  async function handleConfirm() {
    if (!selectedProjectId) return;
    setConfirming(true);
    try {
      await confirmClassification(selectedProjectId);
      toast.success(t("timeline.activityConfirmed"));
      onConfirmed();
    } catch (err) {
      console.error("Failed to confirm classification:", err);
      toast.error(t("timeline.couldNotConfirm"));
    } finally {
      setConfirming(false);
      setShowConfirm(false);
    }
  }

  async function handleDoubleClick() {
    if (!activity.project_id) return;
    setConfirming(true);
    try {
      await confirmClassification(activity.project_id);
      toast.success(t("timeline.activityConfirmed"));
      onConfirmed();
    } catch (err) {
      console.error("Failed to confirm classification:", err);
      toast.error(t("timeline.couldNotConfirm"));
    } finally {
      setConfirming(false);
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        onDoubleClick={handleDoubleClick}
        className="absolute inset-x-1 z-[5] cursor-pointer overflow-hidden rounded-md border border-dashed border-(--color-text-muted)/30 bg-(--color-text-muted)/8 px-2 py-0.5 text-left opacity-50 transition-opacity hover:opacity-70"
        style={style}
        title={`${activity.app_name}${activity.window_title ? ` — ${activity.window_title}` : ""}`}
      >
        {isCompact ? (
          <span className="truncate text-[10px] italic text-(--color-text-muted)">
            {activity.app_name}
            {confidencePct !== null ? ` ${confidencePct}%` : ""}
          </span>
        ) : (
          <>
            <div className="truncate text-xs italic text-(--color-text-muted)">
              {activity.app_name}
            </div>
            <div className="truncate text-[10px] text-(--color-text-muted)/70">
              {formatDuration(activity.duration)}
              {confidencePct !== null ? ` · ${confidencePct}%` : ""}
            </div>
          </>
        )}
      </button>

      {/* Confirm popup */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onMouseDown={() => setShowConfirm(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("timeline.confirmActivity")}
            className="relative z-10 w-72 rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-2xl"
          >
            <h3 className="mb-1 text-sm font-semibold text-(--color-text)">
              {t("timeline.confirmActivity")}
            </h3>
            <p className="mb-3 text-xs text-(--color-text-muted)">
              {activity.app_name}
              {activity.window_title ? ` — ${activity.window_title}` : ""} ·{" "}
              {formatDuration(activity.duration)}
            </p>

            {/* Project selector */}
            <div className="relative mb-3">
              {loadFailed && (
                <PickerLoadError
                  kind={loadFailed}
                  onRetry={retry}
                  className="mb-2"
                />
              )}
              <button
                type="button"
                aria-label={t("common.selectProject")}
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex h-8 w-full items-center justify-between rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs transition-colors hover:border-(--color-text-muted)"
              >
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
                <ChevronDown
                  size={12}
                  className={`text-(--color-text-muted) transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>
              {dropdownOpen && !loadFailed && (
                <div className="absolute top-full z-20 mt-1 max-h-36 w-full overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
                  {projects.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setSelectedProjectId(p.id);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-(--color-border) ${selectedProjectId === p.id ? "bg-(--color-border)" : ""}`}
                    >
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: p.color ?? "#6b7280" }}
                      />
                      <span className="text-(--color-text)">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowConfirm(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={!selectedProjectId || confirming}
              >
                <Check size={14} />
                {confirming ? "..." : t("timeline.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
