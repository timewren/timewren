import type { ServerTimerState, StopOpts, TimerPersisted } from './timer-logic';
import { captureError } from '~/lib/monitoring';
import { storage } from '~/lib/storage';
import { withStopLock } from './stop-lock';
import { isParkedOnServer, serverSessionId } from './timer-logic';
import { fetchRawServerTimer, rescueParkedStop, stopTimerOnServer } from './timer-service';
import { timerActions } from './timer-store';

/**
 * Skrivebogs-lag omkring timerens STOP.
 *
 * Stop-flowet er getStateWithVersion → claimForStop → time.create →
 * confirmStop. Hvis appen dræbes (eller nettet dør) midt i den kæde, ved
 * serveren ikke længere, hvor vi nåede — og ved næste start står vi med en
 * kørende timer og ingen gemt post.
 *
 * Derfor skriver vi en journal FØR kaldet og sletter den først, når vi med
 * sikkerhed ved at stoppet er gennemført. Journalen er det eneste, der
 * overlever et dræb, så den skal være fuldstændig nok til at gentage
 * stoppet bit-for-bit: hele sessions-øjeblikket og det tidspunkt stoppet
 * blev trykket på (time.create får `endTime` derfra, så timeposten bliver
 * identisk ved et gentaget stop).
 *
 * Genstarten beskriver kun, hvad der skal ske — den ringer ingen server op.
 * Det gør `recoverPendingStop`, som først spørger serveren og derefter
 * afgør ud fra dens svar.
 */

export const PENDING_STOP_KEY = 'timer-pending-stop';

export type PendingStop = {
  /** Sessions-øjeblikket da stoppet blev trykket. */
  state: TimerPersisted;
  /** ISO-tidspunkt for stop-øjeblikket — bliver `endTime` på posten. */
  stoppedAt: string;
};

/**
 * Hvad der skal ske med et afbrudt stop:
 * - `resume_stop` — serveren kører stadig DEN session: gemningen landede aldrig.
 * - `parked` — serveren kører ikke, men rækken er lagt til side som pause med
 *   tiden i `baseSeconds` (cronens `timer-cleanup`). Posten er måske aldrig
 *   oprettet, så den skal slås op og genoprettes fra journalen.
 * - `already_saved` — serveren kører ikke, og rækken er ryddet: posten er
 *   gemt (eller stoppet andetsteds).
 * - `replaced` — serveren kører en ANDEN session end vores: vi er blevet overhalet.
 */
export type RecoveryAction
  = | { kind: 'resume_stop' }
    | { kind: 'parked' }
    | { kind: 'already_saved' }
    | { kind: 'replaced' };

/**
 * Konfliktregel ved to enheder / et dræb midt i stoppet.
 *
 * Kædeslutningen på serveren afgør det hele: først når `confirmStop` er
 * landet, ryddes sessionen. Så betyder "serveren kører ikke længere" at
 * posten er gemt, og vi må ALDRIG lave den igen — det ville dobbeltfakturere.
 * Kører serveren stadig vores egen session, er intet gemt, så stoppet skal
 * køres igen.
 *
 * Undtagelsen er en PARKERET række: cronen lægger et stopping-intent, der har
 * stået over fem minutter, til side som pause i stedet for at rydde det, for
 *di rækken så er det eneste sted, sessionen findes. Er den lagt til side, er
 * `confirmStop` altså aldrig landet, og posten kan mange. Derfor skelnes der
 * mellem en ryddet række (elapsed 0, base 0) og en parkeret (base > 0).
 *
 * Rækkefølgen er bevidst: den samme startTime kan aldrig passe på to
 * sessioner, så et resume er trygt, mens et gammelt `version`-tal aldrig er
 * gyldigt at genbruge.
 */
export function resolvePendingStop(server: ServerTimerState, pending: PendingStop): RecoveryAction {
  if (!server.isRunning || !server.startTime)
    return isParkedOnServer(server) ? { kind: 'parked' } : { kind: 'already_saved' };
  // Kender både serveren og journalen sessionens id, skal det også stemme.
  const serverId = serverSessionId(server);
  const pendingId = pending.state.sessionId ?? null;
  const sameId = serverId === null || pendingId === null || serverId === pendingId;
  return server.startTime === pending.state.startTime && sameId
    ? { kind: 'resume_stop' }
    : { kind: 'replaced' };
}

function isPendingStop(value: unknown): value is PendingStop {
  if (typeof value !== 'object' || value === null)
    return false;
  const p = value as Partial<PendingStop>;
  return typeof p.stoppedAt === 'string'
    && typeof p.state === 'object' && p.state !== null
    && typeof p.state.startTime === 'string';
}

/** Journalen læses defensivt: en afkortet værdi må aldrig stoppe appen. */
export function getPendingStop(): PendingStop | null {
  const raw = storage.getString(PENDING_STOP_KEY);
  if (!raw)
    return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPendingStop(parsed) ? parsed : null;
  }
  catch {
    return null;
  }
}

export function setPendingStop(pending: PendingStop | null): void {
  if (pending)
    storage.set(PENDING_STOP_KEY, JSON.stringify(pending));
  else
    storage.remove(PENDING_STOP_KEY);
}

export type RecoveryResult
  = | { kind: 'none' }
    /** Stoppet var færdigt, eller var aldrig igang. */
    | { kind: 'cleared'; action: RecoveryAction['kind'] }
    /** Et afbrudt stop blev kørt igen. */
    | { kind: 'resumed'; saved: boolean }
    /** En parkeret pause blev genoprettet som tidspost. */
    | { kind: 'rescued'; saved: boolean };

type StopDeps = (state: TimerPersisted, opts: StopOpts) => Promise<{ kind: string }>;

type RecoveryDeps = {
  read?: () => PendingStop | null;
  write?: (pending: PendingStop | null) => void;
  fetchServer?: () => Promise<ServerTimerState>;
  stop?: StopDeps;
  /** Genopretter en post fra journalen, når serverens række er parkeret. */
  rescue?: StopDeps;
  /** Den lokale timer skal ryddes, når serveren ikke længere kører den. */
  resetLocal?: () => void;
  fallbackDescription?: string;
};

/**
 * Ét stop ad gangen. Både skærm-layoutet og timeren kalder
 * `recoverPendingStop` (mount + forgrund), og de må ikke begge ramme
 * serveren med det samme stop. Genkald stilles i kø i `stop-lock` — de
 * deler den med `stopTimerNow`, så et afbrudt stop heller ikke kører
 * samtidig med et tryk i appen eller på stop-knappen i notifikationen.
 */

async function runRecovery(deps: RecoveryDeps): Promise<RecoveryResult> {
  const read = deps.read ?? getPendingStop;
  const write = deps.write ?? setPendingStop;
  const fetchServer = deps.fetchServer ?? fetchRawServerTimer;
  const resetLocal = deps.resetLocal ?? (() => timerActions().reset());
  const fallback = deps.fallbackDescription ?? '';

  const pending = read();
  if (!pending)
    return { kind: 'none' };

  let server: ServerTimerState;
  try {
    server = await fetchServer();
  }
  catch {
    return { kind: 'none' };
  }

  const action = resolvePendingStop(server, pending);
  if (action.kind === 'parked') {
    return rescueParked({
      pending,
      write,
      resetLocal,
      fallback,
      // Versionen er beviset på, hvilken række vi redder. `clearParkedRow`
      // kræver den samme version, så en pause brugeren lagde på web imens
      // redningen kørte ikke bliver nulstillet som om den var vores.
      version: server.version,
      rescue: deps.rescue ?? rescueParkedStop,
    });
  }

  if (action.kind !== 'resume_stop') {
    write(null);
    // Serveren kører ikke vores session: den lokale er død og skal væk.
    resetLocal();
    return { kind: 'cleared', action: action.kind };
  }

  const stop = deps.stop ?? stopTimerOnServer;
  try {
    const result = await stop(pending.state, {
      fallbackDescription: fallback,
      now: new Date(pending.stoppedAt),
      // Journalen er beviset: den findes kun, fordi vi selv tog et claim til
      // et stop, der aldrig blev bekræftet. Serverens `source` kan ikke bruges
      // — web-appen sender præcis det samme "web" som mobilen.
      ownClaim: true,
    });
    // Kun et gennemført stop rydder journalen. Ved save_failed/claim_failed
    // står serverens session stadig i live, så prøver vi igen næste gang.
    // `session_changed`: serveren kører en anden session end journalens — der er
    // intet at genoptage, og næste afstemning viser den aktuelle.
    if (result.kind === 'saved' || result.kind === 'stopped_elsewhere' || result.kind === 'session_changed') {
      write(null);
      resetLocal();
    }
    // `saved_unconfirmed` er et specialtilfælde: posten LIGGER på serveren,
    // men claimet kunne ikke bekræftes, så rækken hænger i 'stopping'.
    // Tiden er reddet, men journalen skal blive liggende, så næste forsøg
    // bekræfter — og springer posten over, for den findes jo allerede.
    return { kind: 'resumed', saved: result.kind !== 'save_failed' && result.kind !== 'claim_failed' };
  }
  catch (error) {
    captureError(error);
    return { kind: 'resumed', saved: false };
  }
}

/**
 * Færdiggør et stop, der blev afbrudt af et dræb eller tabt net.
 *
 * Køres ved app-start og når appen kommer i forgrunden, FØR den almindelige
 * afstemning — ellers ville afstemningen se den kørende session og tro, at
 * brugeren stadig er i gang med at time.
 *
 * Kaster aldrig: uden net er der intet at hente, og journalen bliver liggende
 * til næste forsøg. Kun når serveren svarer, og kun når vi er sikre på
 * udfaldet, rydder vi journalen.
 */
export function recoverPendingStop(deps: RecoveryDeps = {}): Promise<RecoveryResult> {
  return withStopLock(() => runRecovery(deps));
}

type RescueCtx = {
  pending: PendingStop;
  write: (pending: PendingStop | null) => void;
  resetLocal: () => void;
  fallback: string;
  /** Serverens version, da vi besluttede at rækken var den parkerede rest. */
  version: number;
  rescue: StopDeps;
};

/**
 * Genopret et stop, hvis række serverens cron har parkeret som pause.
 *
 * Claim-kæden kan ikke bruges her — serveren kører ikke, så et nyt claim
 * ville blive afvist med `no_timer`. I stedet slås posten op og genoprettes
 * fra journalen, hvis den mangler (`rescueParkedStop` i `timer-service`).
 *
 * Journalen ryddes kun, når posten ligger på serveren. Ellers bliver den
 * liggende, så næste forgrund igen prøver — tiden må ikke tabes, fordi
 * kaldet døde halvt inde.
 */
async function rescueParked({ pending, write, resetLocal, fallback, version, rescue }: RescueCtx): Promise<RecoveryResult> {
  try {
    const result = await rescue(pending.state, {
      fallbackDescription: fallback,
      now: new Date(pending.stoppedAt),
      expectedVersion: version,
    });
    if (result.kind !== 'saved')
      return { kind: 'rescued', saved: false };
    write(null);
    resetLocal();
    return { kind: 'rescued', saved: true };
  }
  catch (error) {
    captureError(error);
    return { kind: 'rescued', saved: false };
  }
}
