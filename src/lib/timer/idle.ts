/**
 * Ren beslutningslogik for inaktivitet ("idle") omkring den kørende timer.
 *
 * Designet (kunde A runde 6, #588) er IKKE længere auto-pause: almindelig
 * inaktivitet — og skærmlås — pauser ikke timeren. Første detektor (web eller
 * extension) der ser inaktivitet registrerer tidspunktet på serveren
 * (`timer_states.idle_detected_at`); når brugeren kommer tilbage bliver hun
 * spurgt hvad der skal ske med det MÅLTE fravær. En fast tærskel trækkes
 * aldrig fra.
 *
 * Eneste undtagelse er lang stilstand (`autoPauseAfterMinutes`, default 120):
 * der pauses timeren med elapsed sat til værdien ved `idleDetectedAt`, så de
 * mange timer ikke tælles med.
 *
 * Modulet er bevidst frit for React, tRPC og chrome-API'er.
 */

import { shouldSendBackgroundTimerWrite } from "./tab-owner";

export interface IdleReturnInput {
  /** Hvornår inaktiviteten blev registreret (ms siden epoch), eller null. */
  idleDetectedAtMs: number | null;
  /** "Nu" i ms — injiceres så testene er deterministiske. */
  nowMs: number;
  /** Spørg-tærskel i minutter (timer_states.idle_threshold_minutes). */
  thresholdMinutes: number;
  /** Hård auto-pause efter X minutter. null/0 = slået fra. */
  autoPauseAfterMinutes: number | null;
}

export type IdleReturnDecision =
  /** Intet at gøre — ingen registreret inaktivitet, eller under tærsklen. */
  | { action: "none"; awaySeconds: number }
  /** Spørg brugeren hvad der skal ske med de målte `awaySeconds`. */
  | { action: "ask"; awaySeconds: number }
  /** Stilstanden oversteg den hårde grænse — timeren skal pauses. */
  | { action: "auto-pause"; awaySeconds: number };

/** Målt fravær i sekunder. 0 når der ikke er registreret inaktivitet. */
export function awaySeconds(
  idleDetectedAtMs: number | null,
  nowMs: number,
): number {
  if (!idleDetectedAtMs) return 0;
  return Math.max(0, Math.floor((nowMs - idleDetectedAtMs) / 1000));
}

/** Hvad skal der ske når brugeren er tilbage (eller vagthunden kigger)? */
export function decideOnReturn(input: IdleReturnInput): IdleReturnDecision {
  if (!input.idleDetectedAtMs) return { action: "none", awaySeconds: 0 };
  const away = awaySeconds(input.idleDetectedAtMs, input.nowMs);

  const hardLimit = input.autoPauseAfterMinutes;
  if (hardLimit && hardLimit > 0 && away >= hardLimit * 60) {
    return { action: "auto-pause", awaySeconds: away };
  }

  const askLimit = Math.max(1, input.thresholdMinutes) * 60;
  if (away >= askLimit) return { action: "ask", awaySeconds: away };

  return { action: "none", awaySeconds: away };
}

/**
 * Vagthundens tik, mens brugeren stadig er væk: skal DENNE fane pause
 * timeren nu? Vagthunden kører i alle åbne faner (TimerEnhancements), så kun
 * ejer-fanen (lib/timer/tab-owner.ts) må, ellers sender hver fane sin egen
 * pause. Pausen ved tilbagekomst er ikke gated: brugeren udløser den i den
 * fane, brugeren vender tilbage til, og serverens klip af idle-stemplet
 * giver den kun til én fane.
 */
export function shouldWatchdogAutoPause(
  input: IdleReturnInput & { isOwner: boolean },
): boolean {
  return (
    shouldSendBackgroundTimerWrite({
      background: true,
      isOwner: input.isOwner,
    }) && decideOnReturn(input).action === "auto-pause"
  );
}

/**
 * Elapsed (sekunder) som timeren stod på da inaktiviteten begyndte — brugt af
 * både "Fjern de X min" og den hårde auto-pause.
 */
export function elapsedAtIdle(
  currentElapsedSeconds: number,
  away: number,
): number {
  return Math.max(0, Math.floor(currentElapsedSeconds - away));
}
