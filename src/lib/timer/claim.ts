import { sql } from "drizzle-orm";
import { clearedRowSql, isClearedTimerRow } from "./resurrection";
import { isSameSessionStart } from "./session-match";

/**
 * claimForStop (web + extension) må kun lykkes, når der faktisk er en session
 * at stoppe: timeren kører, eller der står (pauset) tid på rækken. Et claim på
 * en RYDDET række — sessionen er allerede stoppet og gemt et andet sted —
 * gav ellers grønt lys til at gemme den samme session én gang til.
 *
 * Prædikatet indgår i claimets atomiske UPDATE ... WHERE.
 */
export function hasSomethingToStopSql() {
  return sql`NOT ${clearedRowSql()}`;
}

export type ClaimMiss =
  | { success: false; reason: "no_timer"; version: number }
  | {
      success: false;
      reason: "already_stopping";
      version: number;
      stoppedBy: string | null;
    }
  | { success: false; reason: "version_mismatch"; version: number }
  | { success: false; reason: "session_mismatch"; version: number };

/**
 * Klassificér et claim der ikke matchede (læsning EFTER den atomiske
 * skrivning — den afgør ingen skrivning). Rækkefølgen er vigtig: et stop i
 * gang rapporteres før en ryddet række. Med `expectedStartTime` (mobil, A7
 * S2) rapporteres en ANDEN session (eller en pause) som `session_mismatch`,
 * så klienten afstemmer i stedet for at prøve igen med den nye version.
 */
export function classifyClaimMiss(
  existing:
    | {
        isRunning: boolean | null;
        elapsedSeconds: number | null;
        baseSeconds: number | null;
        intent: string | null;
        intentFrom: string | null;
        version: number;
        startTime?: Date | null;
        currentSessionId?: string | null;
      }
    | undefined,
  expectedStartTime?: number,
  /** Server-udstedt session klienten vil stoppe (timer-sessioner, fase 1). */
  expectedSessionId?: string,
): ClaimMiss {
  if (!existing) {
    return { success: false, reason: "no_timer", version: 0 };
  }
  if (existing.intent === "stopping") {
    return {
      success: false,
      reason: "already_stopping",
      version: existing.version,
      stoppedBy: existing.intentFrom,
    };
  }
  if (isClearedTimerRow(existing)) {
    return { success: false, reason: "no_timer", version: existing.version };
  }
  if (
    expectedSessionId !== undefined &&
    (existing.currentSessionId ?? null) !== expectedSessionId
  ) {
    return {
      success: false,
      reason: "session_mismatch",
      version: existing.version,
    };
  }
  if (
    expectedStartTime !== undefined &&
    !isSameSessionStart(existing.startTime, new Date(expectedStartTime))
  ) {
    return {
      success: false,
      reason: "session_mismatch",
      version: existing.version,
    };
  }
  return {
    success: false,
    reason: "version_mismatch",
    version: existing.version,
  };
}
