import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, History, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { formatElapsed } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Project, ProjectSuggestion, RecentEntry } from "@/lib/types";
import { useTimerStore } from "@/stores/timerStore";

export function TimerWidget() {
  const { t } = useTranslation();
  const {
    isRunning,
    elapsed,
    projectName,
    clientName,
    projectColor,
    description: activeDescription,
    start,
    stop,
  } = useTimerStore();

  // Ét kald for begge lister, og én fejltilstand for dem begge: en kunde uden
  // projekt er et gyldigt valg, så en vælger der kunne vise den ene og skjule
  // den anden, ville skjule halvdelen af den tilstand brugeren står overfor.
  const { projects, clients, loadFailed, retry } = useProjectClientPicker();
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<ProjectSuggestion | null>(null);

  useEffect(() => {
    // Kun en hjælpeliste: mangler den, kan brugeren stadig starte på en kunde
    // eller uden projekt, så den har ingen fejltilstand, og `.catch(() => {})`
    // er her rigtigt. Det er *valgene* der ikke må forsvinde lydløst.
    tauriInvoke<RecentEntry[]>("get_recent_entries", { limit: 5 })
      .then(setRecentEntries)
      .catch(() => {});

    // One-shot foreground probe: pre-fill the project from the current window
    // context (git repo / folder / app) when the classifier is confident.
    // Only fills an empty field — never overrides a manual choice — and does
    // not affect auto-tracking. No match → field stays empty.
    tauriInvoke<ProjectSuggestion | null>("suggest_project_for_context")
      .then((s) => {
        if (!s) return;
        setSuggestion(s);
        setSelectedProjectId((current) => current ?? s.project_id);
      })
      .catch(() => {});
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // The client follows the project, in one direction only: a project sets the
  // client to its own — clearing it when it has none, so a project cannot bill
  // an unrelated client. "No project" keeps the chosen client on purpose, since
  // "Acme, no project" is a legitimate timer. An unknown project (the list is
  // still loading) leaves the client alone instead of clearing it on a race.
  useEffect(() => {
    if (!selectedProjectId) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) return;
    setSelectedClientId(project.client_id ?? null);
  }, [selectedProjectId, projects]);

  function selectProject(project: Project | null) {
    setSelectedProjectId(project?.id ?? null);
    setDropdownOpen(false);
  }

  async function handleStartStop() {
    if (isRunning) {
      await stop();
    } else {
      await start(selectedProjectId, selectedClientId, description || null);
      setDescription("");
      setSuggestion(null);
    }
  }

  async function handleContinueRecent(entry: RecentEntry) {
    await start(
      entry.project_id ?? null,
      entry.client_id ?? null,
      entry.description ?? null,
    );
  }

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-6">
      {/* Timer display */}
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={isRunning ? "running" : "stopped"}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-center"
            >
              <span
                className={`font-mono text-5xl font-bold tracking-tight ${
                  isRunning
                    ? "text-(--color-text)"
                    : "text-(--color-text-muted)"
                }`}
              >
                {formatElapsed(elapsed)}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Active info when running */}
        {isRunning && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-sm text-(--color-text-muted)"
          >
            {projectColor && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: projectColor }}
              />
            )}
            {projectName && (
              <span className="font-medium text-(--color-text)">
                {projectName}
              </span>
            )}
            {clientName && <span>({clientName})</span>}
            {activeDescription && (
              <>
                <span className="text-(--color-border)">—</span>
                <span>{activeDescription}</span>
              </>
            )}
            {!projectName && !activeDescription && (
              <span>{t("timer.noProjectSelected")}</span>
            )}
          </motion.div>
        )}

        {/* Controls when stopped */}
        {!isRunning && (
          <div className="flex w-full max-w-md flex-col gap-3">
            {loadFailed && (
              <PickerLoadError kind={loadFailed} onRetry={retry} />
            )}

            {/* Client selector — independent of the project, so the timer can
                run on a client that has no project of its own. */}
            <select
              aria-label={t("form.clientLabel")}
              value={selectedClientId ?? ""}
              onChange={(e) => setSelectedClientId(e.target.value || null)}
              className="h-10 rounded-lg border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none"
            >
              {/* «Ingen kunder» er en *påstand* om brugerens data. Når
                  indlæsningen fejlede, er den ikke længere sand — så feltet
                  siger det neutrale, og fejlen står lige ovenfor. */}
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

            {/* Project selector */}
            <div className="relative">
              <button
                type="button"
                aria-label={t("timer.selectProject")}
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex h-10 w-full items-center justify-between rounded-lg border border-(--color-border) bg-(--color-bg) px-3 text-sm transition-colors hover:border-(--color-text-muted)"
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
                      : t("timer.selectProject")}
                  </span>
                  {selectedProject?.client_name && (
                    <span className="text-(--color-text-muted)">
                      ({selectedProject.client_name})
                    </span>
                  )}
                </div>
                <ChevronDown
                  size={16}
                  className={`text-(--color-text-muted) transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        selectProject(null);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-(--color-text-muted) hover:bg-(--color-border)"
                    >
                      {t("timer.noProjectOption")}
                    </button>
                    {projects.map((project) => (
                      <button
                        type="button"
                        key={project.id}
                        onClick={() => {
                          selectProject(project);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--color-border) ${
                          selectedProjectId === project.id
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
                        {project.client_name && (
                          <span className="text-(--color-text-muted)">
                            ({project.client_name})
                          </span>
                        )}
                      </button>
                    ))}
                    {projects.length === 0 && (
                      <div className="px-3 py-2 text-sm text-(--color-text-muted)">
                        {t("timer.noProjectsFound")}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* "Suggested because" label — shown while the pre-filled
                suggestion is still the selected project. */}
            {suggestion && selectedProjectId === suggestion.project_id && (
              <p className="-mt-1 text-xs text-(--color-text-muted)">
                {t("suggestion.label", {
                  project: suggestion.project_name,
                  reason: t(`suggestion.reason.${suggestion.reason_kind}`, {
                    value: suggestion.reason_detail,
                  }),
                })}
              </p>
            )}

            {/* Description input */}
            <input
              type="text"
              aria-label={t("common.description")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleStartStop();
              }}
              placeholder={t("timer.whatAreYouWorkingOn")}
              className="h-10 rounded-lg border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) placeholder:text-(--color-text-muted) focus:border-(--color-accent) focus:outline-none"
            />
          </div>
        )}

        {/* Start/Stop button */}
        <motion.button
          type="button"
          onClick={handleStartStop}
          whileTap={{ scale: 0.95 }}
          className={`flex h-12 w-40 items-center justify-center gap-2 rounded-full text-sm font-semibold text-white transition-colors ${
            isRunning
              ? "bg-red-500 hover:bg-red-600"
              : "bg-emerald-500 hover:bg-emerald-600"
          }`}
        >
          {isRunning ? (
            <>
              <Square size={16} fill="currentColor" />
              {t("timer.stop")}
            </>
          ) : (
            <>
              <Play size={16} fill="currentColor" />
              {t("timer.start")}
            </>
          )}
        </motion.button>

        {/* Recent entries — "Continue from recent" */}
        {!isRunning && recentEntries.length > 0 && (
          <div className="flex w-full max-w-md flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
              <History size={12} />
              <span>{t("timer.continueFromRecent")}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recentEntries.map((entry, i) => {
                const label = [entry.project_name, entry.description]
                  .filter(Boolean)
                  .join(" — ");
                if (!label) return null;
                return (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: unique combo
                    key={i}
                    type="button"
                    onClick={() => handleContinueRecent(entry)}
                    className="flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-bg) px-2.5 py-1 text-xs text-(--color-text-muted) transition-colors hover:border-(--color-accent) hover:text-(--color-text)"
                  >
                    {entry.project_color && (
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: entry.project_color }}
                      />
                    )}
                    <span className="max-w-[160px] truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
