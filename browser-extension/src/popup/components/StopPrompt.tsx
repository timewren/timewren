import { X } from "lucide-react";
import { useState } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useT } from "../../i18n";
import { useTimerStore } from "../../stores/timerStore";
import type { Client, Project } from "../../types";
import { ClientProjectSelect } from "./ClientProjectSelect";

interface StopPromptProps {
  clients: Client[];
  projects: Project[];
  className?: string;
}

/**
 * "{t("popup.stopPrompt.question")}" Delt af alle stopknapper (Timer,
 * mini-timeren og ny fanes chip) via `requestStop` i timer-storen, så ingen
 * af dem gemmer tavst som intern tid.
 *
 * "Vælg kunde" gemmer den kørende/pausede tid på den valgte kunde — det
 * starter ikke forfra. Lukkes vælgeren, er intet valgt, og næste kundevalg
 * er et almindeligt valg igen.
 */
export function StopPrompt({
  clients,
  projects,
  className = "",
}: StopPromptProps) {
  const { t } = useT();
  const open = useTimerStore((s) => s.stopPromptOpen);
  const setOpen = useTimerStore((s) => s.setStopPromptOpen);
  const stopTimer = useTimerStore((s) => s.stopTimer);
  const updateProject = useTimerStore((s) => s.updateProject);
  const timer = useTimerStore((s) => s.timer);
  const [picking, setPicking] = useState(false);
  const promptRef = useModalDialog(() => setOpen(false), open, {
    modal: false,
  });

  const handleSaveInternal = () => {
    setOpen(false);
    void stopTimer(null, null);
  };

  const handlePickClient = () => {
    setOpen(false);
    setPicking(true);
  };

  const handleSelect = async (
    projectId: string | null,
    clientId: string | null,
  ) => {
    setPicking(false);
    await updateProject(projectId, clientId);
    const project = projects.find((p) => p.id === projectId);
    const client = clients.find((c) => c.id === clientId);
    await stopTimer(project?.name ?? null, client?.name ?? null);
  };

  return (
    <>
      {open && (
        <div
          ref={promptRef}
          tabIndex={-1}
          className={`px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg outline-none ${className}`}
          role="alertdialog"
          aria-label={t("popup.stopPrompt.title")}
        >
          <div className="flex items-start gap-2 mb-2">
            <p className="flex-1 text-sm text-amber-800">
              {t("popup.stopPrompt.question")}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-amber-700 hover:text-amber-800 hover:bg-amber-100"
              aria-label={t("popup.stopPrompt.close")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePickClient}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border-strong)] rounded-lg hover:bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
            >
              {t("popup.stopPrompt.pickClient")}
            </button>
            <button
              type="button"
              onClick={handleSaveInternal}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 text-amber-800"
            >
              {t("popup.stopPrompt.saveInternal")}
            </button>
          </div>
        </div>
      )}

      {picking && (
        <ClientProjectSelect
          clients={clients}
          projects={projects}
          selectedProjectId={timer?.projectId ?? null}
          selectedClientId={timer?.clientId ?? null}
          onSelect={handleSelect}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
