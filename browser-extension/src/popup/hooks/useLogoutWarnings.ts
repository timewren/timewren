import { useT } from "../../i18n";
import { useOfflineStore } from "../../stores/offlineStore";
import { useTimerStore } from "../../stores/timerStore";

/** Det brugeren skal vide, før der logges ud. */
export function useLogoutWarnings(): string[] {
  const { t } = useT();
  const timer = useTimerStore((s) => s.timer);
  const hasSession = useTimerStore(
    (s) => !!s.timer?.isRunning || s.displayTime > 0,
  );
  const queueLength = useOfflineStore((s) => s.queue.length);
  const warnings: string[] = [];
  if (hasSession) {
    warnings.push(
      timer?.isRunning
        ? t("popup.logoutWarnings.running")
        : t("popup.logoutWarnings.paused"),
    );
  }
  if (queueLength > 0) {
    warnings.push(t("popup.logoutWarnings.queue", { count: queueLength }));
  }
  return warnings;
}
