import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Coffee, Phone, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { formatDuration, formatTime } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { IdleReturnPayload } from "@/lib/types";
import { toast } from "@/stores/toastStore";

/** One overlapping calendar event with a project + customer guess (mirrors OverlappingEvent). */
interface OverlappingEvent {
  event: { id: number; summary: string | null };
  guess_project_id: string | null;
  guess_project_name: string | null;
  guess_client_id: string | null;
  guess_client_name: string | null;
}

/**
 * Non-blocking prompt shown when the tracker emits `idle-return` — i.e. the user
 * came back after a long idle window (a meeting, a phone call). It offers to log
 * the gap as a time entry so billable away-from-keyboard time is not lost.
 *
 * A toast-style card in the bottom-right; it never steals focus (no modal, no
 * backdrop). Choosing a project calls `log_idle_period`. "Pause/kassér" and
 * dismissing save nothing. An overlapping calendar event pre-fills the project
 * and description.
 */
export function IdleReturnPrompt() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<IdleReturnPayload | null>(null);
  // Listerne er de samme for hvert prompt, så de hentes mens et prompt står
  // åbent — ikke for hver `idle-return`. Ét kald for begge, én fejltilstand.
  const { projects, clients, loadFailed, retry } = useProjectClientPicker({
    active: payload !== null,
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    const unlistenPromise = listen<IdleReturnPayload>(
      "idle-return",
      (event) => {
        const p = event.payload;
        setPayload(p);
        setSelectedProjectId(null);
        setSelectedClientId(null);
        setDescription("");
        setDropdownOpen(false);

        // Pre-fill project, customer and description from an overlapping
        // calendar event. A customer-only match carries the customer, so a
        // meeting with a customer that has no project of their own is still
        // attributed to them.
        tauriInvoke<OverlappingEvent[]>("list_events_overlapping", {
          from: p.start,
          to: p.end,
        })
          .then((events) => {
            const match = events[0];
            if (!match) return;
            if (match.guess_project_id) {
              setSelectedProjectId(match.guess_project_id);
            }
            if (match.guess_client_id) {
              setSelectedClientId(match.guess_client_id);
            }
            if (match.event.summary) {
              setDescription(match.event.summary);
            }
          })
          .catch(() => {
            // No calendar / no overlap — the user fills it in manually.
          });
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // The client follows the project, in one direction only — the same rule as
  // the manual entry form: a project sets the client to its own, clearing it
  // when it has none, so a project can never bill an unrelated customer chosen
  // earlier. "Intet projekt" keeps the chosen client, since a customer with no
  // project is a legitimate registration.
  useEffect(() => {
    if (!selectedProjectId) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) return;
    setSelectedClientId(project.client_id ?? null);
  }, [selectedProjectId, projects]);

  const dismiss = useCallback(() => {
    // Dismiss without saving anything (Pause/kassér and close both do this).
    setPayload(null);
    setDropdownOpen(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    },
    [dismiss],
  );

  useEffect(() => {
    if (payload) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [payload, handleKeyDown]);

  // Log the idle window for the given quick-choice label. `label` seeds the
  // description when the user hasn't typed / no calendar event pre-filled one.
  async function logWith(label: string) {
    if (!payload || logging) return;
    setLogging(true);
    try {
      await tauriInvoke("log_idle_period", {
        start: payload.start,
        end: payload.end,
        projectId: selectedProjectId,
        clientId: selectedClientId,
        description: description.trim() || label || null,
      });
      toast.success(t("idlePrompt.logged"));
      setPayload(null);
      setDropdownOpen(false);
    } catch (err) {
      console.error("Failed to log idle period:", err);
      toast.error(typeof err === "string" ? err : t("idlePrompt.couldNotLog"));
    } finally {
      setLogging(false);
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <AnimatePresence>
      {payload && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-label={t("idlePrompt.title")}
          className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-(--color-text)">
                {t("idlePrompt.awayFor", {
                  duration: formatDuration(payload.durationSecs),
                })}
              </h3>
              <p className="mt-0.5 text-xs text-(--color-text-muted)">
                {formatTime(payload.start)}–{formatTime(payload.end)} ·{" "}
                {t("idlePrompt.question")}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={dismiss}
              className="rounded-md p-1 text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
            >
              <X size={14} />
            </button>
          </div>

          {loadFailed && (
            <PickerLoadError
              kind={loadFailed}
              onRetry={retry}
              className="mt-3"
            />
          )}

          {/* Client selector — independent of the project, so a meeting with a
              customer who has no project of their own is still billable. */}
          <div className="relative mt-3">
            <label htmlFor="idle-client" className="sr-only">
              {t("form.clientLabel")}
            </label>
            <select
              id="idle-client"
              value={selectedClientId ?? ""}
              onChange={(e) => setSelectedClientId(e.target.value || null)}
              className="h-8 w-full rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
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

          {/* Project selector (pre-filled from an overlapping calendar event) */}
          <div className="relative mt-2">
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
                {selectedProject?.name ?? t("common.noProject")}
              </span>
              <ChevronDown
                size={12}
                className={`text-(--color-text-muted) transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              />
            </button>
            {dropdownOpen && !loadFailed && (
              <div className="absolute bottom-full z-20 mb-1 max-h-40 w-full overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
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

          {/* Description (pre-filled from the calendar event, overridable) */}
          <input
            type="text"
            aria-label={t("idlePrompt.descriptionLabel")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("idlePrompt.descriptionPlaceholder")}
            className="mt-2 h-8 w-full rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text) placeholder:text-(--color-text-muted)/60 focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          />

          {/* Quick choices */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <QuickButton
              icon={<Users size={13} />}
              label={t("idlePrompt.meeting")}
              disabled={logging}
              onClick={() => logWith(t("idlePrompt.meeting"))}
            />
            <QuickButton
              icon={<Phone size={13} />}
              label={t("idlePrompt.phone")}
              disabled={logging}
              onClick={() => logWith(t("idlePrompt.phone"))}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={dismiss}
              disabled={logging}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
            >
              <Coffee size={13} />
              {t("idlePrompt.discard")}
            </button>
            <button
              type="button"
              onClick={() => logWith("")}
              disabled={logging}
              className="rounded-md bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {logging ? "..." : t("idlePrompt.logProject")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QuickButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1.5 text-xs font-medium text-(--color-text) transition-colors hover:border-(--color-accent) hover:bg-(--color-accent)/8 disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}
