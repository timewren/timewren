import { t } from "../i18n/core";
/**
 * Ren idle-logik for extensionen (kunde A runde 6, #588).
 *
 * Extensionen pauser IKKE længere timeren ved `chrome.idle`-events. `"idle"`
 * og `"locked"` registrerer kun HVORNÅR inaktiviteten begyndte; ved
 * tilbagekomst spørges brugeren om det MÅLTE fravær. Kun lang stilstand
 * (`autoPauseAfterMinutes`, default 120) pauser hårdt — og så med elapsed sat
 * til værdien ved `idleDetectedAt`.
 *
 * Modulet holdes fri for chrome-API'er, så det kan testes med vitest fra
 * roden (se vitest.config.ts: browser-extension/src/**\/*.test.ts).
 */

export type IdleReturnAction = "none" | "ask" | "auto-pause";

export interface IdleDecisionInput {
  /** Hvornår inaktiviteten blev registreret (ms), eller null når ryddet. */
  idleDetectedAtMs: number | null;
  nowMs: number;
  /** Spørg-tærskel i minutter. */
  thresholdMinutes: number;
  /** Hård auto-pause efter X minutter. null/0 = fra. */
  autoPauseAfterMinutes: number | null;
}

export interface IdleDecision {
  action: IdleReturnAction;
  /** Målt fravær i sekunder. */
  awaySeconds: number;
}

export function measureAwaySeconds(
  idleDetectedAtMs: number | null,
  nowMs: number,
): number {
  if (!idleDetectedAtMs) return 0;
  return Math.max(0, Math.floor((nowMs - idleDetectedAtMs) / 1000));
}

export function decideIdleReturn(input: IdleDecisionInput): IdleDecision {
  if (!input.idleDetectedAtMs) return { action: "none", awaySeconds: 0 };
  const away = measureAwaySeconds(input.idleDetectedAtMs, input.nowMs);

  const hardLimit = input.autoPauseAfterMinutes;
  if (hardLimit && hardLimit > 0 && away >= hardLimit * 60) {
    return { action: "auto-pause", awaySeconds: away };
  }
  if (away >= Math.max(1, input.thresholdMinutes) * 60) {
    return { action: "ask", awaySeconds: away };
  }
  return { action: "none", awaySeconds: away };
}

/**
 * Elapsed som timeren stod på da inaktiviteten begyndte. Bruges både til
 * "Fjern de X min" og til den hårde auto-pause — aldrig en fast tærskel.
 */
export function elapsedAtIdleStart(
  currentElapsedSeconds: number,
  awaySeconds: number,
): number {
  return Math.max(0, Math.floor(currentElapsedSeconds - awaySeconds));
}

/** Timerens nuværende elapsed ud fra en serverrække (base + løbende session). */
export function currentElapsedSeconds(
  timer: { startTime?: string | null; baseSeconds?: number | null },
  nowMs: number,
): number {
  const session = timer.startTime
    ? Math.max(
        0,
        Math.floor((nowMs - new Date(timer.startTime).getTime()) / 1000),
      )
    : 0;
  return Math.max(0, (timer.baseSeconds || 0) + session);
}

/** Tekst til notifikationen på det aktive sprog: "23 min" / "2 t 5 min". */
export function formatAway(awaySeconds: number): string {
  const minutes = Math.max(1, Math.round(awaySeconds / 60));
  if (minutes < 60) return t("format.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t("format.hours", { value: hours })
    : t("format.hoursMinutes", { hours, minutes: rest });
}
