import { useQuery } from "@tanstack/react-query";
import { Square } from "lucide-react";
import { useEffect } from "react";
import { apiClient } from "../../api/client";
import { useT } from "../../i18n";
import { useAuthStore } from "../../stores/authStore";
import { useTimerStore } from "../../stores/timerStore";
import { ElapsedClock } from "./ElapsedClock";

interface MiniTimerProps {
  onSwitchToTimer: () => void;
}

export function MiniTimer({ onSwitchToTimer }: MiniTimerProps) {
  const { t } = useT();
  const timer = useTimerStore((s) => s.timer);
  const requestStop = useTimerStore((s) => s.requestStop);
  const tick = useTimerStore((s) => s.tick);
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);

  const { data: projectsData } = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5,
    enabled: orgsLoaded,
  });

  useEffect(() => {
    if (!timer?.isRunning) return;
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [timer?.isRunning, tick]);

  const project = projectsData?.projects.find((p) => p.id === timer?.projectId);
  const client = projectsData?.clients.find((c) => c.id === timer?.clientId);
  const label =
    client?.name ||
    project?.name ||
    timer?.description ||
    t("popup.mini.timerLabel");

  // Uden kunde spørges der i Timer-fanen ("Gem som intern tid?")
  const handleStop = () => {
    if (requestStop(project?.name ?? null, client?.name ?? null)) {
      onSwitchToTimer();
    }
  };

  // To søskendeknapper: en knap i en knap er ugyldig HTML og kan ikke nås
  // med tastaturet hver for sig.
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-subtle)] animate-slide-down w-full">
      <button
        type="button"
        onClick={onSwitchToTimer}
        className="flex-1 flex items-center gap-2 min-w-0 min-h-6 rounded text-left"
        aria-label={t("popup.mini.goTo", { label })}
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success)] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-success)]" />
        </span>
        <span className="text-xs font-semibold text-[var(--color-success)]">
          <ElapsedClock />
        </span>
        <span className="text-xs text-[var(--color-text-secondary)] truncate">
          {label}
        </span>
      </button>
      <button
        type="button"
        onClick={handleStop}
        className="w-6 h-6 rounded-full bg-[var(--color-danger)] flex items-center justify-center flex-shrink-0 hover:opacity-80 transition-opacity"
        title={t("popup.mini.stop")}
        aria-label={t("popup.mini.stop")}
      >
        <Square
          size={10}
          className="text-white"
          fill="white"
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
