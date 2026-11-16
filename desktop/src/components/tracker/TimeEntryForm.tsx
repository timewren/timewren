import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { formatDate, toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import { createTimeEntry, resolveEntryTimes } from "@/lib/timeEntryActions";
import type { Project, ProjectSuggestion, TimeEntry } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface TimeEntryFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  entry: TimeEntry | null; // null = create mode, object = edit mode
  /** Optional pre-filled date for create mode (YYYY-MM-DD) */
  defaultDate?: string;
  /** Optional pre-filled start time for create mode (HH:MM) */
  defaultStartTime?: string;
  /** Optional pre-filled end time for create mode (HH:MM) */
  defaultEndTime?: string;
}

export function TimeEntryForm({
  open,
  onClose,
  onSaved,
  entry,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
}: TimeEntryFormProps) {
  const { t } = useTranslation();
  const isEditing = entry !== null;

  // Valgene til formen hentes mens den er åben — ikke ved mount — og begge
  // lister deler én fejltilstand, så en fejl i den ene ikke skjuler den anden.
  const { projects, clients, loadFailed, retry } = useProjectClientPicker({
    active: open,
  });
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

  // Form state
  const [projectId, setProjectId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(toLocalDateStr(new Date()));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isBillable, setIsBillable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ProjectSuggestion | null>(null);

  // Initialize form values when dialog opens or entry changes
  useEffect(() => {
    if (!open) return;

    if (entry) {
      setProjectId(entry.project_id);
      setClientId(entry.client_id);
      setDescription(entry.description ?? "");
      const startDate = new Date(entry.start_time);
      setDate(toLocalDateStr(startDate));
      setStartTime(
        `${startDate.getHours().toString().padStart(2, "0")}:${startDate.getMinutes().toString().padStart(2, "0")}`,
      );
      if (entry.end_time) {
        const endDate = new Date(entry.end_time);
        setEndTime(
          `${endDate.getHours().toString().padStart(2, "0")}:${endDate.getMinutes().toString().padStart(2, "0")}`,
        );
      } else {
        setEndTime("");
      }
      setIsBillable(entry.is_billable);
    } else {
      // Create mode — use provided defaults or current time
      setProjectId(null);
      setClientId(null);
      setDescription("");
      setDate(defaultDate ?? toLocalDateStr(new Date()));
      if (defaultStartTime) {
        setStartTime(defaultStartTime);
      } else {
        const now = new Date();
        setStartTime(
          `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`,
        );
      }
      setEndTime(defaultEndTime ?? "");
      setIsBillable(true);
    }
    setError(null);
  }, [open, entry, defaultDate, defaultStartTime, defaultEndTime]);

  // Create mode only: one-shot foreground probe to pre-fill the project from
  // the current window context (git repo / folder / app) on a confident match.
  // Never overrides a manual pick and does not affect auto-tracking. No match
  // → field stays empty as before.
  useEffect(() => {
    if (!open || entry) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    tauriInvoke<ProjectSuggestion | null>("suggest_project_for_context")
      .then((s) => {
        if (cancelled || !s) return;
        setSuggestion(s);
        setProjectId((current) => current ?? s.project_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, entry]);

  // The client follows the project, in one direction only: a project sets the
  // client to its own — clearing it when it has none, so a project cannot bill
  // an unrelated client that was chosen earlier. "Intet projekt" keeps the
  // chosen client on purpose, since "Acme, intet projekt" is a legitimate
  // registration. An unknown project (the list is still loading) leaves the
  // client alone instead of clearing it on a race.
  useEffect(() => {
    if (!projectId) return;
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    setClientId(project.client_id ?? null);
  }, [projectId, projects]);

  const selectedProject = projects.find((p) => p.id === projectId);

  // What the current date + times would save as, so a midnight-crossing shift
  // is visible before the user presses save.
  const preview = useMemo(
    () => resolveEntryTimes(date, startTime, endTime),
    [date, startTime, endTime],
  );

  // Group projects by client for the dropdown
  const projectsByClient = new Map<string | null, Project[]>();
  for (const project of projects) {
    const key = project.client_id;
    const group = projectsByClient.get(key) ?? [];
    group.push(project);
    projectsByClient.set(key, group);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Et sluttidspunkt før starttidspunktet betyder nattskift (22:00 → 02:00),
    // ikke en fejl: `resolveEntryTimes` ruller slutningen til næste dag.
    const resolved = resolveEntryTimes(date, startTime, endTime);
    if (!resolved.ok) {
      setError(
        resolved.error === "startMissing"
          ? t("timeEntry.startTimeRequired")
          : resolved.error === "endMissing"
            ? t("timeEntry.endTimeRequired")
            : t("timeEntry.endAfterStart"),
      );
      return;
    }
    const { start_time, end_time, duration } = resolved.times;

    setSaving(true);
    try {
      if (isEditing) {
        await tauriInvoke("update_time_entry", {
          entry: {
            id: entry.id,
            remote_id: entry.remote_id,
            project_id: projectId,
            client_id: clientId,
            klippekort_id: entry.klippekort_id,
            description: description || null,
            start_time,
            end_time,
            duration,
            is_billable: isBillable,
            is_running: false,
            source: entry.source,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            synced_at: entry.synced_at,
            project_name: null,
            client_name: null,
            project_color: null,
          },
        });
      } else if (
        !(await createTimeEntry({
          project_id: projectId,
          client_id: clientId,
          klippekort_id: null,
          description: description || null,
          start_time,
          end_time,
          duration,
          is_billable: isBillable,
        }))
      ) {
        // Et dobbeltklik er allerede ved at gemme denne registrering.
        return;
      }
      toast.success(
        isEditing ? t("timeEntry.entryUpdated") : t("timeEntry.entryCreated"),
      );
      onSaved();
    } catch (err) {
      console.error("Failed to save time entry:", err);
      setError(t("timeEntry.couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEditing ? t("timeEntry.editEntry") : t("timeEntry.newEntry")}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving
              ? t("common.saving")
              : isEditing
                ? t("timeEntry.saveChanges")
                : t("common.create")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {loadFailed && <PickerLoadError kind={loadFailed} onRetry={retry} />}

        {/* Client selector — independent of the project, so time can be
            registered for a client that has no project of its own. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="entry-client"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("form.clientLabel")}
          </label>
          <select
            id="entry-client"
            value={clientId ?? ""}
            onChange={(e) => setClientId(e.target.value || null)}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            {/* «Ingen kunder» er en påstand om brugerens data, og den er
                ikke sand, når indlæsningen fejlede. */}
            <option value="">
              {clients.length === 0 && !loadFailed
                ? t("projects.noClients")
                : t("form.noClient")}
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
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
              onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
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

            {projectDropdownOpen && !loadFailed && (
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
                {Array.from(projectsByClient.entries()).map(
                  ([cId, groupProjects]) => {
                    const client = clients.find((c) => c.id === cId);
                    return (
                      <div key={cId ?? "no-client"}>
                        {cId && client && (
                          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-(--color-text-muted)/60">
                            {client.name}
                          </div>
                        )}
                        {groupProjects.map((project) => (
                          <button
                            type="button"
                            key={project.id}
                            onClick={() => {
                              setProjectId(project.id);
                              setProjectDropdownOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--color-border) ${
                              projectId === project.id
                                ? "bg-(--color-border)"
                                : ""
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
                            {!cId && project.client_name && (
                              <span className="text-(--color-text-muted)">
                                ({project.client_name})
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </div>
          {/* "Suggested because" label — shown while the pre-filled
              suggestion is still the selected project. */}
          {suggestion && projectId === suggestion.project_id && (
            <p className="text-xs text-(--color-text-muted)">
              {t("suggestion.label", {
                project: suggestion.project_name,
                reason: t(`suggestion.reason.${suggestion.reason_kind}`, {
                  value: suggestion.reason_detail,
                }),
              })}
            </p>
          )}
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="entry-description"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("common.description")}
          </label>
          <textarea
            id="entry-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("timeEntry.descriptionPlaceholder")}
            rows={2}
            className="resize-none rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          />
        </div>

        {/* Date + Time inputs row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="entry-date"
              className="text-xs font-medium text-(--color-text-muted)"
            >
              {t("common.date")}
            </label>
            <input
              id="entry-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="entry-start-time"
              className="text-xs font-medium text-(--color-text-muted)"
            >
              {t("common.start")}
            </label>
            <input
              id="entry-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-2 font-mono text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="entry-end-time"
              className="text-xs font-medium text-(--color-text-muted)"
            >
              {t("common.end")}
            </label>
            <input
              id="entry-end-time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-2 font-mono text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
            />
          </div>
        </div>

        {/* A shift from e.g. 22:00 to 02:00 ends on the next day. Say so, so
            the saved end time is never a surprise. */}
        {preview.ok && preview.times.crossesMidnight && (
          <p className="text-xs text-(--color-text-muted)">
            {t("timeEntry.endsNextDay", {
              date: formatDate(preview.times.end_time),
              time: endTime,
            })}
          </p>
        )}

        {/* Billable toggle */}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isBillable}
            onChange={(e) => setIsBillable(e.target.checked)}
            className="h-4 w-4 rounded border border-(--color-border) accent-(--color-accent)"
          />
          <span className="text-sm text-(--color-text)">
            {t("common.billable")}
          </span>
        </label>

        {/* Error message */}
        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
