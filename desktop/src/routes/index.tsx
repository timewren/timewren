import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ActiveKlippekort } from "@/components/dashboard/ActiveKlippekort";
import { LowKlippekortAlert } from "@/components/dashboard/LowKlippekortAlert";
import { OverBudgetProjects } from "@/components/dashboard/OverBudgetProjects";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { WeekSummary } from "@/components/dashboard/WeekSummary";
import { PomodoroTimer } from "@/components/tracker/PomodoroTimer";
import { TimeEntryList } from "@/components/tracker/TimeEntryList";
import { TimerWidget } from "@/components/tracker/TimerWidget";
import { useTimerStore } from "@/stores/timerStore";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation();
  const loadRunning = useTimerStore((s) => s.loadRunning);

  useEffect(() => {
    loadRunning();
  }, [loadRunning]);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-(--color-text)">
          {t("dashboard.title")}
        </h1>
      </div>

      <TimerWidget />

      {/* Pomodoro-timeren lå i koden siden den blev bygget, men var aldrig
          monteret nogen steder — brugeren kunne ikke nå den. */}
      <PomodoroTimer />

      <TimeEntryList />

      {/* Proactive alert: klippekort low on balance or near expiry */}
      <LowKlippekortAlert />

      {/* Dashboard widgets */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <WeekSummary />
        <ActiveKlippekort />
      </div>

      <OverBudgetProjects />

      <RecentActivity />
    </div>
  );
}
