"use client";

import { useElectricTimer } from "@/hooks/useElectricTimer";

/**
 * ElectricSQL debug badge (issue #260). Renders a small live status chip only
 * when the Electric proxy is reachable (ELECTRIC_URL set on the server, which
 * is both beta and prod since 26/10). DashboardShell only mounts it for
 * platform admins. Observe-only; it does not affect the real timer.
 */
export function ElectricTimerDebug() {
  const { connected, row, lastUpdate } = useElectricTimer();

  if (!connected) return null;

  const pulse = lastUpdate && Date.now() - lastUpdate < 1500;

  return (
    <div
      className="fixed bottom-3 left-3 z-[90] flex items-center gap-2 rounded-full border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-800 shadow-sm dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
      title="ElectricSQL live-sync (beta spike): observe-only, påvirker ikke timeren"
    >
      <span
        className={`h-2 w-2 rounded-full ${pulse ? "bg-green-500" : "bg-purple-500"} transition-colors`}
      />
      <span>Electric live</span>
      {row ? (
        <span className="text-purple-500 dark:text-purple-400">
          timer {row.is_running ? "▶ kører" : "⏸ stoppet"} · v{row.version}
        </span>
      ) : (
        <span className="text-purple-400">ingen timer-række</span>
      )}
    </div>
  );
}
