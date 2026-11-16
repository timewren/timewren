import { CalendarClock, Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { timeToHours } from "@/lib/calendar";
import { formatTime } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { TimeEntry, UncoveredCalendarEvent } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface CalendarSuggestionBlockProps {
  item: UncoveredCalendarEvent;
  hourHeight: number;
  startHour: number;
  /** Called after the event has been logged as a time entry. */
  onLogged: () => void;
}

/**
 * A dashed suggestion block for an imported calendar event that has not yet
 * been logged as time. Clicking it opens a small dialog to confirm/override the
 * project guess and log the meeting as a time entry via `convert_calendar_event`.
 */
export function CalendarSuggestionBlock({
  item,
  hourHeight,
  startHour,
  onLogged,
}: CalendarSuggestionBlockProps) {
  const { t } = useTranslation();
  const {
    event,
    guess_project_id,
    guess_project_name,
    guess_client_id,
    guess_client_name,
  } = item;

  const [showDialog, setShowDialog] = useState(false);
  // Kun mens dialogen står åben — blokken mountes én pr. kalenderbegivenhed.
  const { projects, loadFailed, retry } = useProjectClientPicker({
    active: showDialog,
    clients: false,
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    guess_project_id,
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [logging, setLogging] = useState(false);

  // Reset the selection to the guess whenever the dialog is reopened.
  useEffect(() => {
    if (showDialog) setSelectedProjectId(guess_project_id);
  }, [showDialog, guess_project_id]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setShowDialog(false);
  }, []);

  useEffect(() => {
    if (showDialog) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [showDialog, handleKeyDown]);

  const style = useMemo(() => {
    const startH = timeToHours(event.start_time);
    const endH = timeToHours(event.end_time) || startH + 0.5;
    const top = (startH - startHour) * hourHeight;
    const height = Math.max((endH - startH) * hourHeight, 4);
    return { top: `${top}px`, height: `${height}px`, minHeight: "18px" };
  }, [event, hourHeight, startHour]);

  const isCompact = parseFloat(style.height) < 44;
  const title = event.summary ?? t("calendar.fromCalendar");

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const selectedProjectName =
    selectedProject?.name ??
    (selectedProjectId === guess_project_id ? guess_project_name : null);
  // With no project, the entry is still billed to the customer a rule named. The
  // dialog says so rather than offering a bare "no project", which would be a
  // silent surprise on an invoice.
  const billedTo =
    selectedProjectName ??
    (selectedProjectId === null && guess_client_id ? guess_client_name : null);

  async function handleLog() {
    setLogging(true);
    try {
      await tauriInvoke<TimeEntry>("convert_calendar_event", {
        eventId: event.id,
        projectId: selectedProjectId,
      });
      toast.success(t("calendar.meetingLogged"));
      setShowDialog(false);
      onLogged();
    } catch (err) {
      console.error("Failed to log calendar event:", err);
      toast.error(t("calendar.couldNotLogMeeting"));
    } finally {
      setLogging(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="absolute inset-x-2 z-[6] cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-(--color-accent)/50 bg-(--color-accent)/8 px-2 py-1 text-left transition-colors hover:bg-(--color-accent)/15"
        style={style}
        title={`${title} · ${formatTime(event.start_time)}–${formatTime(event.end_time)}`}
      >
        {isCompact ? (
          <span className="flex items-center gap-1 truncate text-[10px] font-medium text-(--color-accent)">
            <CalendarClock size={10} className="shrink-0" />
            {title}
          </span>
        ) : (
          <>
            <div className="flex items-center gap-1 truncate text-xs font-semibold text-(--color-accent)">
              <CalendarClock size={11} className="shrink-0" />
              {title}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-(--color-accent)/70">
              {formatTime(event.start_time)}–{formatTime(event.end_time)}
              {guess_project_name || guess_client_name
                ? ` · ${guess_project_name ?? guess_client_name}`
                : ""}
            </div>
          </>
        )}
      </button>

      {/* Log dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onMouseDown={() => setShowDialog(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("calendar.logMeetingTitle")}
            className="relative z-10 w-72 rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-2xl"
          >
            <h3 className="mb-1 text-sm font-semibold text-(--color-text)">
              {t("calendar.logMeetingTitle")}
            </h3>
            <p className="mb-3 truncate text-xs text-(--color-text-muted)">
              {title} · {formatTime(event.start_time)}–
              {formatTime(event.end_time)}
            </p>

            {/* Project selector (pre-filled with the guess, overridable) */}
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
                    billedTo
                      ? "text-(--color-text)"
                      : "text-(--color-text-muted)"
                  }
                >
                  {billedTo ?? t("common.noProject")}
                </span>
                <ChevronDown
                  size={12}
                  className={`text-(--color-text-muted) transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>
              {dropdownOpen && !loadFailed && (
                <div className="absolute top-full z-20 mt-1 max-h-36 w-full overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(null);
                      setDropdownOpen(false);
                    }}
                    className="flex w-full items-center px-2 py-1.5 text-left text-xs text-(--color-text-muted) hover:bg-(--color-border)"
                  >
                    {t("common.noProject")}
                  </button>
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
                onClick={() => setShowDialog(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={handleLog} disabled={logging}>
                <Check size={14} />
                {logging ? "..." : t("calendar.logAsTime")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
