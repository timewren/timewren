/**
 * Expected run interval (in minutes) for each cron job.
 * Used to determine whether a job is "silent" — i.e. has not run
 * within 2× its expected interval.
 *
 * Skal matche crontabben i cron/entrypoint.sh (den der kører i prod).
 * crontab-consistency.test.ts fejler, hvis de to glider fra hinanden.
 */
export const EXPECTED_INTERVAL_MINUTES: Record<string, number> = {
  "data-export": 2,
  "timer-cleanup": 5,
  "refresh-tokens": 5,
  "webhook-retry": 5,
  "email-sync": 5,
  import: 2,
  "calendar-sync": 15,
  "invoice-sync": 15,
  "end-of-day": 15,
  "idle-warning": 15,
  // Stabilitetsvagten (detektorer for timer-/datafejl)
  "stability-watch": 15,
  recurring: 60,
  "migration-drift": 60,
  // Offentlig demo: sletter demokonti over 24 timer (no-op uden DEMO_MODE)
  "demo-cleanup": 60,
  "daily-digest": 24 * 60,
  "webhook-cleanup": 24 * 60,
  "calendar-webhook-renew": 24 * 60,
  "prepaid-alerts": 24 * 60,
  // Månedsbudget: 80/100 %-advarsler pr. projekt (#592)
  "budget-alerts": 24 * 60,
  "deadline-alerts": 24 * 60,
  "drip-emails": 24 * 60,
  "inactivity-check": 24 * 60,
  dunning: 24 * 60,
  "ai-suggestions": 24 * 60, // Mon–Fri
  "trial-reminder": 24 * 60,
  "trial-expire": 24 * 60,
  "weekly-summary": 7 * 24 * 60,
  // Kører dagligt (#622) — selve udsendelsen filtreres pr. bruger i routen
  "unbilled-reminder": 24 * 60,
  // Dækningsgrad under brugerens tærskel i går (#679)
  "coverage-reminder": 24 * 60,
  "monthly-summary": 30 * 24 * 60,
  "admin-digest": 7 * 24 * 60,
  // Enterprise ferie (#461): optjening d. 1. i måneden, årsskifte dagligt
  "vacation-accrual": 31 * 24 * 60,
  "vacation-year-rollover": 24 * 60,
  // Periodeafslutning (#518): opgørelser dagligt 04:45
  "period-closing": 24 * 60,
  // Planlagte satsændringer anvendes dagligt 00:05
  "scheduled-rates": 24 * 60,
  "manager-digest": 24 * 60,
  "compliance-forecast": 7 * 24 * 60,
  // Dobbelt-abonnement-vagt mod Alunta (kunde B-incident 1/9-2026)
  "alunta-duplicate-subs": 24 * 60,
  "invoice-overdue": 24 * 60,
  "invoice-reminders": 24 * 60,
  "report-schedules": 24 * 60,
  "seat-reconciliation": 24 * 60,
  // Køb i appen: sikkerhedsnet for tabte butiksnotifikationer
  "store-billing-sweep": 24 * 60,
  "client-status-report": 24 * 60,
  "prepaid-renewals": 24 * 60,
  "churn-playbooks": 24 * 60,
  // Enterprise timeseddel-påmindelse, fredag
  "timesheet-reminder": 7 * 24 * 60,
  // Gentagne fakturaer (#198): kladder for forfaldne skabeloner dagligt 06:50
  "recurring-invoices": 24 * 60,
};

/** All job names that are expected to run. */
export const EXPECTED_JOB_NAMES = Object.keys(EXPECTED_INTERVAL_MINUTES);

/**
 * Returns true when a job is considered "silent":
 *  - it has never run, OR
 *  - the last run is older than 2× its expected interval.
 */
export function isJobSilent(jobName: string, lastRunAt: Date | null): boolean {
  const intervalMinutes = EXPECTED_INTERVAL_MINUTES[jobName];
  // Ukendt jobnavn: vi kender ikke et forventet interval, så vi kan ikke
  // afgøre om det er tavst. Før faldt det tilbage til interval 0, hvilket
  // gjorde ethvert ukendt job "tavst" et millisekund efter sidste kørsel.
  if (intervalMinutes === undefined) return false;
  if (!lastRunAt) return true;
  return Date.now() - lastRunAt.getTime() > 2 * intervalMinutes * 60 * 1000;
}

/**
 * Human-readable label for an interval given in minutes.
 * E.g. 2 → "hvert 2 min", 60 → "hver time", 1440 → "dagligt"
 */
export function formatExpectedInterval(minutes: number): string {
  if (minutes < 60) return `hvert ${minutes} min`;
  if (minutes === 60) return "hver time";
  if (minutes < 24 * 60) return `hver ${Math.round(minutes / 60)}. time`;
  if (minutes === 24 * 60) return "dagligt";
  if (minutes === 7 * 24 * 60) return "ugentligt";
  if (minutes >= 30 * 24 * 60) return "månedligt";
  return `hver ${Math.round(minutes / (24 * 60))} dage`;
}
