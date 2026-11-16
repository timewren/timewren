/**
 * Én fane pr. browser-profil laver timerens baggrunds-skrivninger
 * (adoption-write, heartbeat, periodisk sync af kørende tid). Uden det
 * adopterer og heartbeater hver åben fane uafhængigt af hinanden — de bumper
 * hinandens serverversion, og to af tre faner får `version_conflict` hver
 * gang en anden enhed (fx extensionen) starter en timer (bevist i
 * `timer_events`, se docs/reports/2026-10-26-timer-tab-owner.md).
 *
 * Ejerskab afgøres med Web Locks API: alle faner anmoder om samme eksklusive
 * lås og venter i kø (FIFO). Browseren frigiver automatisk en holdt lås, når
 * fanens dokument destrueres (lukning/navigation), så næste fane i køen
 * bliver ejer uden noget eksplicit håndtryk mellem faner.
 *
 * Browsere uden `navigator.locks` (gamle browsere, SSR, tests) falder
 * tilbage til dagens adfærd: alle faner er ejere — ingen regression af den
 * koordinering der allerede findes (fx heartbeat-observer.ts).
 */

export const TAB_OWNER_LOCK_NAME = "timetrack-timer-owner";

/** Den del af LockManager/navigator.locks vi faktisk bruger — gør koden testbar uden en rigtig browser. */
export interface LocksLike {
  request: (
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal; ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ) => Promise<void>;
}

/**
 * Findes Web Locks API'en i dette miljø? Tjekker også `window`, fordi Node
 * (SSR) nu selv har et globalt `navigator.locks` (en rigtig LockManager) —
 * uden det tjek ville serveren tro den kunne koordinere faner.
 */
export function hasWebLocksSupport(
  nav: { locks?: unknown } | undefined = typeof window !== "undefined" &&
  typeof navigator !== "undefined"
    ? navigator
    : undefined,
): nav is { locks: LocksLike } {
  return (
    !!nav && typeof (nav as { locks?: LocksLike }).locks?.request === "function"
  );
}

/**
 * Anmoder om eksklusivt ejerskab af timer-skrivninger i denne browser.
 * `onOwnershipChange(true, handover)` fyrer så snart denne fane er ejer:
 * med det samme (`handover` false), hvis låsen var fri, eller senere
 * (`handover` true), når en tidligere ejer frigiver (lukker/navigerer væk).
 * Kun en overdragelse betyder, at fanen skal overtage en timer, en anden
 * fane har skrevet. Returnerer en afmeldingsfunktion, der frigiver
 * anmodningen/låsen igen — bruges ved unmount i en SPA, hvor dokumentet ikke
 * destrueres af en client-side navigation.
 */
export function requestTabOwnership(
  locks: LocksLike,
  onOwnershipChange: (isOwner: boolean, handover?: boolean) => void,
): () => void {
  const controller = new AbortController();
  let releaseHeld: (() => void) | null = null;
  const hold = (handover: boolean) => {
    // Afmeldt mens anmodningen var på vej: slip låsen med det samme.
    if (controller.signal.aborted) return Promise.resolve();
    onOwnershipChange(true, handover);
    // Holdt så længe fanen lever. En browserlås frigives automatisk når
    // dokumentet destrueres. abort() frigiver KUN en ventende anmodning,
    // så en almindelig unmount (fx React strict mode, betinget layout)
    // slipper den holdte lås ved at afgøre dette promise.
    return new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
  };
  const ignore = () => {
    // AbortError fra cleanup, eller anmodningen blev afvist — fanen er
    // simpelthen ikke (længere) ejer. Intet at gøre her.
  };
  // Først uden kø (ifAvailable kan ikke kombineres med signal): er låsen
  // fri, er fanen ejer fra start. Ellers stil op i køen.
  void locks
    .request(
      TAB_OWNER_LOCK_NAME,
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (lock) return hold(false);
        if (controller.signal.aborted) return;
        void locks
          .request(
            TAB_OWNER_LOCK_NAME,
            { mode: "exclusive", signal: controller.signal },
            () => hold(true),
          )
          .catch(ignore);
      },
    )
    .catch(ignore);
  return () => {
    controller.abort();
    releaseHeld?.();
    onOwnershipChange(false);
  };
}

export interface TabOwnershipState {
  isOwner: boolean;
  /** Ejerskabet kom fra en anden fane, der frigav det (ikke fra start). */
  handover: boolean;
}

/**
 * Én ejerskabs-anmodning pr. fane, delt af alle i fanen, der skal kende
 * ejerskabet (useTimerSync og TimerEnhancements). To anmodninger fra samme
 * fane står i kø bag hinanden: den anden ville aldrig blive ejer, så længe
 * den første holdt låsen. Låsen anmodes ved første abonnent og frigives,
 * når den sidste afmelder.
 */
export function createSharedTabOwnership(locks: LocksLike) {
  let state: TabOwnershipState = { isOwner: false, handover: false };
  const listeners = new Set<(next: TabOwnershipState) => void>();
  let release: (() => void) | null = null;
  return {
    get: () => state,
    subscribe(listener: (next: TabOwnershipState) => void): () => void {
      listeners.add(listener);
      if (!release) {
        release = requestTabOwnership(locks, (isOwner, handover = false) => {
          state = { isOwner, handover: isOwner && handover };
          for (const notify of listeners) notify(state);
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !release) return;
        const releaseLock = release;
        release = null;
        releaseLock();
      };
    },
  };
}

/**
 * Må denne timer-skrivning sendes herfra? Brugerhandlinger (`background:
 * false` — start, stop, pause, skift kunde/projekt, ret tid) sendes ALTID,
 * uanset ejerskab: de er eksplicitte og går gennem serverens atomiske
 * guards. Kun automatiske baggrunds-skrivninger (adoption-write, heartbeat,
 * periodisk sync) gates på ejerskab.
 */
export function shouldSendBackgroundTimerWrite(opts: {
  background: boolean;
  isOwner: boolean;
}): boolean {
  return !opts.background || opts.isOwner;
}

/**
 * Skal fanen overtage timeren, nu hvor den er blevet ejer? Kun ved en ægte
 * overdragelse fra en anden fane, mens timeren kører, og efter mount-
 * afstemningen. Et ejerskab fra start (fx genindlæsning af eneste fane) er
 * ikke en overtagelse: dér afgør afstemningen selv, om der skal adopteres,
 * og et adoptions-flag sat før den ville følge med næste skrivning.
 */
export function shouldTakeOverOnHandover(opts: {
  handover: boolean;
  isRunning: boolean;
  pendingMountReconcile: boolean;
}): boolean {
  return opts.handover && opts.isRunning && !opts.pendingMountReconcile;
}
