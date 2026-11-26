import { create } from "zustand";
import { apiClient } from "../api/client";
import { t } from "../i18n/core";
import { userErrorMessage } from "../lib/api-error";
import {
  canStoreServerChoice,
  fromServerChoice,
  isPrepaidDeductionError,
  type PrepaidChoice,
  resolvePrepaidPackage,
  restoreStoredChoice,
  type StoredPrepaidChoice,
} from "../lib/prepaid";
import {
  buildQuickAddPayload,
  canQuickAdd,
  createQuickAddQueue,
  displayTimeFor,
} from "../lib/quick-add";
import { Sentry } from "../lib/sentry";
import {
  saveWithRetry,
  serverHasActiveSession,
  WRITE_AHEAD_GRACE_MS,
} from "../lib/stop-save";
import { notifyTimerChanged } from "../lib/timer-changed";
import {
  adoptMessage,
  type SessionAwareResponse,
  sessionField,
  type WriteOutcome,
  writeOutcome,
} from "../lib/timer-session";
import type { PrepaidPackage, TimerState } from "../types";
import { formatLocalDate } from "../utils/date";
import {
  deferPersisted,
  enqueuePersisted,
  pendingStopVersions,
  releasePersisted,
  removePersisted,
  useOfflineStore,
} from "./offlineStore";

interface StopResult {
  hours: number;
  projectName: string | null;
  clientName: string | null;
  /** Serverens kvittering når tiden blev trukket fra et klippekort. */
  prepaidDeduction: {
    packageName: string;
    hoursDeducted: number;
    remainingHours: number;
    overflowedToInvoice: boolean;
  } | null;
  /** Advarsel når et valgt kort ikke kunne bruges — tiden ER gemt. */
  prepaidWarning: string | null;
  /** Serveren bekræftede ikke gemmet — posten ligger i offline-køen med
   *  samme clientEntryId og sendes af baggrunden (aldrig som dublet). */
  pendingSave: boolean;
}

async function getSelectedOrgId(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(["selectedOrgId"]);
    return typeof result.selectedOrgId === "string"
      ? result.selectedOrgId
      : null;
  } catch {
    return null;
  }
}

/**
 * Klippekort-valget for den kørende timer gemmes i chrome.storage.local
 * (samme mønster som fx siteStore), så det overlever at popup'en lukkes.
 * Serverens timer-state har intet metadata-felt, så valget bor kun lokalt —
 * nøglet til BÅDE kunden og timer-sessionen (startTime), så et gammelt valg
 * aldrig genopstår på en senere timer på samme kunde. Pause/genoptag/start
 * re-nøgler det gemte valg til den nye session.
 */
const PREPAID_CHOICE_KEY = "timerPrepaidChoice";

async function persistPrepaidChoice(
  choice: PrepaidChoice,
  clientId: string | null,
  sessionStart: string | null,
): Promise<void> {
  try {
    if (choice.mode === "auto") {
      await chrome.storage.local.remove([PREPAID_CHOICE_KEY]);
    } else {
      const stored: StoredPrepaidChoice = { choice, clientId, sessionStart };
      await chrome.storage.local.set({ [PREPAID_CHOICE_KEY]: stored });
    }
  } catch {
    // Best-effort — valget lever videre i memory for denne popup-session
  }
}

async function loadPrepaidChoice(
  clientId: string | null,
  sessionStart: string | null,
): Promise<PrepaidChoice> {
  try {
    const result = await chrome.storage.local.get([PREPAID_CHOICE_KEY]);
    return restoreStoredChoice(
      result[PREPAID_CHOICE_KEY] as StoredPrepaidChoice | undefined,
      clientId,
      sessionStart,
    );
  } catch {
    return { mode: "auto" };
  }
}

/**
 * Valget gemmes OGSÅ på serveren (#422), så stop fra web-appen og appen
 * trækker fra samme kort. Lokalt lager er stadig kilden mens en skrivning er
 * undervejs eller fejlede — så rulles et synligt valg aldrig tilbage af en
 * baggrunds-sync med serverens ældre valg.
 */
let choicePushPending = false;

function pushPrepaidChoice(
  timer: TimerState | null,
  choice: PrepaidChoice,
): void {
  if (!timer?.clientId || !canStoreServerChoice(timer)) return;
  choicePushPending = true;
  apiClient
    .setPrepaidChoice(timer.clientId, choice)
    .then((result) => {
      if (result.success) choicePushPending = false;
    })
    .catch(() => {
      // Best-effort: valget gælder stadig for stop fra extensionen, og
      // næste fetchTimerState prøver igen.
    });
}

/**
 * Server-udstedte sessioner (2.6.0): en skrivning der ikke landede (en anden
 * session står på rækken, sessionen er midt i et stop, eller starten blev
 * afvist) returnerer serverens tilstand. Den adopteres — vi genopliver aldrig
 * vores lokale kopi. Intet går tabt: en session vi ikke længere bærer, er
 * stoppet/gemt eller afløst et andet sted, og dens tid ligger dér.
 *
 * Returnerer true når tilstanden er adopteret (kalderen stopper).
 */
function adoptIfNotLanded(
  timerState: TimerState &
    SessionAwareResponse & { version?: number; intent?: string | null },
  outcomes: readonly WriteOutcome[] = [
    "session_mismatch",
    "stopping",
    "start_rejected",
  ],
): boolean {
  const outcome = writeOutcome(timerState);
  if (!outcomes.includes(outcome)) return false;
  const state = useTimerStore.getState();
  const isStopping = timerState.intent === "stopping";
  const clientChanged =
    (timerState.clientId ?? null) !== (state.timer?.clientId ?? null);
  if (clientChanged) void persistPrepaidChoice({ mode: "auto" }, null, null);
  useTimerStore.setState({
    timer: isStopping ? { ...timerState, isRunning: false } : timerState,
    displayTime: isStopping ? 0 : calculateDisplayTime(timerState),
    serverVersion: timerState.version ?? state.serverVersion,
    isSyncing: false,
    remoteStopping: isStopping,
    error: adoptMessage(outcome, timerState.startRejected),
    ...(clientChanged ? { prepaidChoice: { mode: "auto" as const } } : {}),
  });
  return true;
}

/**
 * Lokale skrivninger tælles, så en hentning der var i luften, mens en egen
 * start/stop/skift skete, kan genkendes som forældet og droppes — ellers kan
 * et gammelt svar overskrive en netop startet timer.
 */
let writeSeq = 0;

/**
 * Beskrivelsen gemmes uden at blokere knapperne (#13: første klik på Start
 * eller Stop efter en skrevet beskrivelse gik tabt). Andre skrivninger venter
 * i stedet på den, så versionen de sender er den nyeste.
 */
let descriptionWrite: Promise<void> | null = null;

async function afterDescriptionWrite(): Promise<void> {
  // Kæden kan blive forlænget, mens vi venter — vent til halen står stille
  while (descriptionWrite) {
    const tail = descriptionWrite;
    await tail.catch(() => {});
    if (descriptionWrite === tail) return;
  }
}

/** Venter (højst 25 s) på at en igangværende start/stop/skift er færdig. */
function waitUntilIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (!useTimerStore.getState().isSyncing) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    };
    const timeout = setTimeout(done, 25_000);
    const unsubscribe = useTimerStore.subscribe((state) => {
      if (!state.isSyncing) done();
    });
  });
}

/** Serverens timer som getTimerStateWithVersion (og baggrundens broadcast) leverer den. */
export type ServerTimerState = TimerState & {
  version: number;
  intent?: string | null;
  intentFrom?: string | null;
};

export interface FetchTimerOptions {
  /**
   * Baggrunds-refresh (broadcast, fokus): stille. Rører hverken spinner eller
   * fejlbanner, og en fejlet hentning beholder den sidst kendte timer.
   */
  background?: boolean;
  /** Tilstand fra baggrundens broadcast — så spares et kald til serveren. */
  state?: ServerTimerState;
}

interface TimerStore {
  timer: TimerState | null;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  displayTime: number; // Current display time in seconds
  serverVersion: number; // Track server version for optimistic locking
  lastStopResult: StopResult | null;
  /** Serverens række er midt i et stop fra en anden instans/web-appen. */
  remoteStopping: boolean;
  /** Brugerens klippekort-valg for den kørende timer (default: auto). */
  prepaidChoice: PrepaidChoice;
  /** "Ingen kunde valgt. Gem som intern tid?" venter på svar. */
  stopPromptOpen: boolean;

  setPrepaidChoice: (choice: PrepaidChoice) => void;
  fetchTimerState: (options?: FetchTimerOptions) => Promise<void>;
  startTimer: (
    projectId?: string | null,
    clientId?: string | null,
    description?: string,
  ) => Promise<void>;
  stopTimer: (
    projectName?: string | null,
    clientName?: string | null,
  ) => Promise<void>;
  /**
   * Gem den kørende/pausede session gennem det normale stop-flow og start
   * derefter en ny timer. Starter kun, hvis stoppet faktisk lykkedes.
   */
  stopAndStart: (
    next: {
      projectId: string | null;
      clientId: string | null;
      description?: string;
    },
    current: { projectName: string | null; clientName: string | null },
  ) => Promise<void>;
  cancelTimer: () => Promise<void>;
  pauseTimer: () => Promise<void>;
  resumeTimer: () => Promise<void>;
  /** Quick-add: læg minutter til timeren uden at røre run-state (#595). */
  addMinutes: (minutes: number) => Promise<void>;
  updateDescription: (description: string) => Promise<void>;
  updateProject: (
    projectId: string | null,
    clientId: string | null,
  ) => Promise<void>;
  updateClient: (clientId: string | null) => Promise<void>;
  clearStopResult: () => void;
  clearError: () => void;
  /**
   * Stop fra en hvilken som helst knap (Timer, mini-timer, ny fanes chip):
   * uden kunde og projekt spørges der først, om tiden skal gemmes som intern
   * tid. Returnerer true, hvis spørgsmålet blev åbnet i stedet for et stop.
   */
  requestStop: (
    projectName?: string | null,
    clientName?: string | null,
  ) => boolean;
  setStopPromptOpen: (open: boolean) => void;
  tick: () => void;
}

/**
 * Quick-add (#595) serialiseres gennem én kø, så tre hurtige klik ikke
 * overskriver hinandens baseSeconds. Køen læser den LOKALE state på
 * skrivetidspunktet — den er allerede bumpet optimistisk — og sender derfor
 * altid den nyeste sum, også når flere klik blev samlet i én skrivning.
 *
 * `isRunning`/`startTime` sendes bevidst ikke: serverens partielle merge lader
 * da både run-state og ejerskab (`lastSyncedFrom`) stå urørt, så skrivningen
 * hverken rammer one-running-timer-guarden eller river timeren fra web-appen.
 */
const quickAddQueue = createQuickAddQueue(async () => {
  const { timer, displayTime } = useTimerStore.getState();
  if (!timer) return;

  // Tallene er ABSOLUTTE og allerede lagt sammen af buildQuickAddPayload i
  // addMinutes — derfor sendes den lokale sum som den er, og ikke et delta.
  // Var flere klik samlet i denne runde, er de alle med.
  const timerState = await apiClient.updateTimerState({
    baseSeconds: Math.max(0, timer.baseSeconds || 0),
    elapsedSeconds: Math.max(0, displayTime),
    ...sessionField(timer.sessionId),
  });
  if (adoptIfNotLanded(timerState)) return;

  useTimerStore.setState((state) => {
    const current = state.timer;
    if (!current) return state;

    // Spred ALDRIG hele svaret ind over den lokale timer. Et quick-add-svar
    // der lander efter at brugeren har pauset, ville bære isRunning:true og
    // dermed fortryde pausen. Kun tiden og versionen kommer fra svaret.
    const serverBase = timerState.baseSeconds ?? 0;
    const localBase = current.baseSeconds ?? 0;
    // Kom der flere klik ind mens skrivningen var i luften, må svaret ikke
    // trække displayet tilbage — næste runde i køen sender den nye sum.
    const baseSeconds =
      quickAddQueue.pending() > 0
        ? Math.max(serverBase, localBase)
        : serverBase;
    const merged: TimerState = {
      ...current,
      baseSeconds,
      elapsedSeconds: Math.max(timerState.elapsedSeconds ?? 0, baseSeconds),
    };
    return {
      timer: merged,
      displayTime: calculateDisplayTime(merged),
      serverVersion: timerState.version ?? state.serverVersion,
      error: null,
    };
  });
});

export const useTimerStore = create<TimerStore>((set, get) => ({
  timer: null,
  isLoading: true,
  isSyncing: false,
  error: null,
  displayTime: 0,
  serverVersion: 0,
  lastStopResult: null,
  remoteStopping: false,
  prepaidChoice: { mode: "auto" },
  stopPromptOpen: false,

  setPrepaidChoice: (choice: PrepaidChoice) => {
    const { timer } = get();
    set({ prepaidChoice: choice });
    void persistPrepaidChoice(
      choice,
      timer?.clientId ?? null,
      timer?.startTime ?? null,
    );
    pushPrepaidChoice(timer, choice);
  },

  fetchTimerState: async (options: FetchTimerOptions = {}) => {
    // Midt i et eget start/stop/skift må en baggrunds- eller fokus-hentning
    // ikke overskrive den lokale state (fx vise et afvist stop som stoppet).
    if (get().isSyncing) return;
    const background = options.background === true;
    // Spinner kun ved første indlæsning. Senere hentninger (også "Prøv
    // igen") lader den kendte timer stå, så visningen ikke blinker.
    if (!background) {
      set(
        get().timer === null
          ? { isLoading: true, error: null }
          : { error: null },
      );
    }
    const seqAtStart = writeSeq;
    // Er der skrevet lokalt siden hentningen startede (eller skrives der
    // nu), er svaret forældet.
    const stale = () =>
      get().isSyncing || writeSeq !== seqAtStart || descriptionWrite !== null;
    // Felter der kun sættes ved en forgrundshentning
    const foreground = background ? {} : { isLoading: false, error: null };

    try {
      // Broadcastens tilstand kan være hentet FØR en lokal skrivning, der er
      // landet siden (baggrunden henter også dagens timer, før den sender).
      // Serverens version stiger ved hver skrivning, så en ældre version end
      // vores er forældet — så hentes serverens aktuelle tilstand i stedet.
      const usable =
        options.state &&
        typeof options.state.version === "number" &&
        options.state.version >= get().serverVersion;
      const timerState = usable
        ? (options.state as ServerTimerState)
        : await apiClient.getTimerStateWithVersion();
      if (stale()) {
        if (!background) set({ isLoading: false });
        return;
      }
      const displayTime = calculateDisplayTime(timerState);

      // Klippekort-valget: et eksplicit in-memory-valg må ALDRIG rulles
      // tilbage af en baggrunds-sync (en langsom/fejlet persist ville ellers
      // klippe det synlige valg til Automatisk). Hydrér kun fra storage når
      // in-memory er default — og drop et eksplicit valg hvis kunden er
      // skiftet under os (fx fra web-appen).
      const prevState = get();
      const prevClientId = prevState.timer?.clientId ?? null;
      const inMemoryChoice = prevState.prepaidChoice;
      // Et valg gemt på serveren (fx truffet i web-appen) vinder — medmindre
      // vores eget valg endnu ikke er nået derop (#422).
      const serverChoice = choicePushPending
        ? null
        : fromServerChoice(timerState.prepaidChoice, timerState.clientId);
      const prepaidChoice =
        serverChoice ??
        (inMemoryChoice.mode !== "auto" &&
        (timerState.clientId ?? null) === prevClientId
          ? inMemoryChoice
          : await loadPrepaidChoice(
              timerState.clientId ?? null,
              timerState.startTime ?? null,
            ));
      if (stale()) {
        if (!background) set({ isLoading: false });
        return;
      }
      if (serverChoice) {
        void persistPrepaidChoice(
          serverChoice,
          timerState.clientId ?? null,
          timerState.startTime ?? null,
        );
      } else if (prepaidChoice.mode !== "auto" && !timerState.prepaidChoice) {
        // Serveren kender ikke vores valg (truffet før start, eller en
        // skrivning der fejlede) — send det, så andre flader ser det.
        pushPrepaidChoice(timerState, prepaidChoice);
      }

      // Et stop er i gang (fra web-appen ELLER en anden extension-instans —
      // flere Chrome-profiler/computere deler kilden "extension"). Vis det
      // som stoppende, ikke som en kørende timer man kan arbejde videre på.
      if (timerState.intent === "stopping") {
        // Eget efterladt stop (bekræftelsen ligger i vores kø) er ikke
        // "fra en anden enhed".
        const remoteStopping = !(await pendingStopVersions()).includes(
          timerState.version,
        );
        if (stale()) {
          if (!background) set({ isLoading: false });
          return;
        }
        set({
          timer: { ...timerState, isRunning: false },
          displayTime: 0,
          ...foreground,
          serverVersion: timerState.version,
          prepaidChoice,
          remoteStopping,
        });
        return;
      }

      set({
        timer: timerState,
        displayTime,
        ...foreground,
        serverVersion: timerState.version,
        prepaidChoice,
        remoteStopping: false,
      });
    } catch (error) {
      // Den sidst kendte timer bliver stående: en fejlet hentning betyder
      // ikke, at timeren er væk. En baggrunds-refresh siger ingenting.
      if (background) {
        console.warn("Kunne ikke opdatere timeren i baggrunden:", error);
        return;
      }
      set({
        isLoading: false,
        error: userErrorMessage(error, t("errors.timer.loadFailed")),
      });
    }
  },

  startTimer: async (
    projectId?: string | null,
    clientId?: string | null,
    description = "",
  ) => {
    await afterDescriptionWrite();
    if (get().isSyncing) return;
    // Et valg truffet FØR start (vælgeren vises så snart kunden er valgt)
    // skal overleve starten — det re-nøgles til den nye session nedenfor.
    // Kun hvis timeren startes på en ANDEN kunde end valget blev truffet
    // for, nulstilles det.
    const priorChoice = get().prepaidChoice;
    const priorClientId = get().timer?.clientId ?? null;
    const localHadSession = !!get().timer?.isRunning || get().displayTime > 0;
    writeSeq++;
    set({ isSyncing: true, error: null });

    // Serverens one-running-timer-guard afviser kun en ANDEN kilde. En anden
    // extension-instans (anden Chrome-profil/computer) har samme kilde, og en
    // frisk start herfra ville tavst overskrive dens timer uden at gemme den.
    // Spørg derfor serveren først, og vis den eksisterende timer i stedet.
    try {
      const serverState = await apiClient.getTimerStateWithVersion();
      const ownStops = await pendingStopVersions();
      if (serverHasActiveSession(serverState, ownStops)) {
        const elsewhere = localHadSession ? "" : t("errors.timer.elsewhere");
        const isStopping = serverState.intent === "stopping";
        set({
          timer: isStopping
            ? { ...serverState, isRunning: false }
            : serverState,
          displayTime: isStopping ? 0 : calculateDisplayTime(serverState),
          serverVersion: serverState.version,
          remoteStopping: false,
          isSyncing: false,
          error: isStopping
            ? t("errors.timer.stopInProgress", { elsewhere })
            : t(
                serverState.isRunning
                  ? "errors.timer.alreadyRunning"
                  : "errors.timer.alreadyPaused",
                { elsewhere },
              ),
        });
        return;
      }
    } catch (error) {
      // Kan vi ikke læse serveren, kan vi heller ikke skrive til den — selve
      // starten nedenfor fejler så med en forståelig besked.
      console.warn("Kunne ikke tjekke serverens timer før start:", error);
    }

    try {
      const timerState = await apiClient.updateTimerState({
        isRunning: true,
        startTime: new Date().toISOString(),
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: projectId ?? null,
        clientId: clientId ?? null,
        description,
        // Explicit fresh start — lets the server reject it if the web app (or
        // another client) already has a timer running, so we never end up
        // tracking time on two projects at once.
        isFreshStart: true,
        // 2.6.0 (#784): med en idempotensnøgle lander starten kun på en
        // række uden aktiv session — også når den kørende timer er fra en
        // anden extension-instans (samme kilde). Ellers får vi serverens
        // tilstand tilbage og viser den kørende timer.
        clientOpId: crypto.randomUUID(),
      });
      if (adoptIfNotLanded(timerState, ["start_rejected", "deduplicated"])) {
        return;
      }

      const keepChoice =
        priorChoice.mode !== "auto" && (clientId ?? null) === priorClientId;
      const nextChoice: PrepaidChoice = keepChoice
        ? priorChoice
        : { mode: "auto" };
      void persistPrepaidChoice(
        nextChoice,
        keepChoice ? (clientId ?? null) : null,
        keepChoice ? (timerState.startTime ?? null) : null,
      );
      // Den friske start har ryddet valget på serveren — send et valg truffet
      // før starten nu, hvor sessionen findes (#422).
      choicePushPending = false;
      if (keepChoice) pushPrepaidChoice(timerState, nextChoice);
      set({
        timer: timerState,
        displayTime: 0,
        isSyncing: false,
        error: null,
        remoteStopping: false,
        prepaidChoice: nextChoice,
        serverVersion: timerState.version ?? get().serverVersion,
      });
    } catch (error) {
      // Surface the message (e.g. the server's "Der kører allerede en timer …"
      // conflict) in the error banner, which offers a "Prøv igen" button that
      // re-fetches and reconciles to the actually-running timer. We must NOT
      // call fetchTimerState() here: it synchronously clears `error`, which
      // would swallow the message before the user ever sees it.
      set({
        isSyncing: false,
        error: userErrorMessage(error, t("errors.timer.startFailed")),
      });
    }
  },

  clearStopResult: () => set({ lastStopResult: null }),
  clearError: () => set({ error: null }),
  setStopPromptOpen: (open: boolean) => set({ stopPromptOpen: open }),

  requestStop: (projectName, clientName) => {
    const { timer } = get();
    if (!timer) return false;
    if (!timer.clientId && !timer.projectId) {
      set({ stopPromptOpen: true });
      return true;
    }
    void get().stopTimer(projectName, clientName);
    return false;
  },

  stopTimer: async (
    projectName?: string | null,
    clientName?: string | null,
  ) => {
    await afterDescriptionWrite();
    // Et dobbeltklik, mens beskrivelsen blev gemt, må ikke give to stop
    if (get().isSyncing) return;
    const { timer, displayTime, serverVersion } = get();
    if (!timer) return;

    if (displayTime <= 0) {
      set({
        error: t("errors.timer.nothingToSave"),
      });
      return;
    }

    // The stop flow needs a network round-trip (claimForStop → createTimeEntry
    // → confirmStop), so it can't complete offline. Fail clearly without losing
    // anything: the timer keeps running and can be stopped once back online.
    if (!useOfflineStore.getState().isOnline) {
      set({
        error: t("errors.timer.offlineStop"),
      });
      return;
    }

    writeSeq++;
    set({ isSyncing: true, error: null });

    // Klippekort hentes FØR claim: mellem claim og write-ahead-køen må der
    // ikke ligge et netværkskald — lukkes popup'en dér, står rækken som
    // "stopping" uden nogen kø-kopi af tiden. Hentes for enhver kunde, fordi
    // valget først kendes efter claim (serverens valg kan afvige fra vores).
    // Opslaget må aldrig kunne vælte selve gemmet — fejler det, gemmes posten
    // som normal tid.
    let prefetchedPackages: PrepaidPackage[] | null = null;
    if (timer.clientId) {
      try {
        prefetchedPackages = await apiClient.getActivePackages();
      } catch (error) {
        console.warn("Kunne ikke hente klippekort til træk:", error);
      }
    }

    // Step 1: Claim timer for stop (atomic operation). 2.6.0: claimet bærer
    // vores session, og svaret giver sessionens øjebliksbillede (#785).
    let claimedPrepaidChoice: TimerState["prepaidChoice"] = null;
    let claimedSessionId: string | null = null;
    let claimedSnapshot: {
      projectId: string | null;
      clientId: string | null;
      description: string;
    } | null = null;
    try {
      const claimResult = await apiClient.claimForStop(
        serverVersion,
        timer.sessionId,
      );
      if (!claimResult.success && claimResult.reason === "session_mismatch") {
        // 2.6.0: vores session står ikke længere på rækken (stoppet/gemt
        // eller afløst et andet sted). Vis serverens timer i stedet.
        set({ isSyncing: false });
        await get().fetchTimerState();
        set({ error: adoptMessage("session_mismatch") });
        return;
      }
      if (!claimResult.success) {
        // Timer was stopped from elsewhere — show clear message and
        // reset local state so the UI doesn't show a stale running timer.
        const source =
          claimResult.stoppedBy === "web"
            ? t("errors.timer.stopSourceWeb")
            : t("errors.timer.stopSourceOther");
        set({
          timer: {
            isRunning: false,
            startTime: null,
            elapsedSeconds: 0,
            baseSeconds: 0,
            projectId: null,
            clientId: null,
            description: "",
            lastSyncedAt: null,
          },
          displayTime: 0,
          isSyncing: false,
          // Honest wording: "already_stopping" only means a stop is mid-flight
          // somewhere (possibly our own interrupted attempt) — we can't know
          // that the time IS saved there.
          error:
            claimResult.reason === "already_stopping"
              ? t("errors.timer.stopAlreadyInProgress", { source })
              : t("errors.timer.stopFailed"),
          serverVersion: claimResult.version,
        });
        return;
      }
      claimedPrepaidChoice = claimResult.prepaidChoice ?? null;
      claimedSessionId = claimResult.sessionId ?? timer.sessionId ?? null;
      claimedSnapshot = claimResult.session ?? null;
      set({ serverVersion: claimResult.version });
    } catch (claimError) {
      console.error("Failed to claim timer for stop:", claimError);
      set({
        isSyncing: false,
        error: t("errors.timer.stopNetwork"),
      });
      return;
    }

    // Store time entry data before resetting timer. The interval is derived
    // from tracked time: end = now, start = now minus total tracked seconds
    // (pause gaps collapse into one span).
    const stoppedAt = new Date();
    const startedAt = new Date(stoppedAt.getTime() - displayTime * 1000);
    // Posten gemmes på SESSIONENS projekt/kunde fra claimet — ikke på en
    // evt. forældet lokal kopi (#785 for extensionen).
    const stopProjectId = claimedSnapshot
      ? claimedSnapshot.projectId
      : timer.projectId;
    const stopClientId = claimedSnapshot
      ? claimedSnapshot.clientId
      : timer.clientId;
    const stopDescription = claimedSnapshot
      ? claimedSnapshot.description
      : timer.description;

    // Klippekort: brugerens valg i Timer-fanen afgør trækket — et konkret
    // kort, intet kort, eller (default) kundens auto-kort (kundeønske
    // 6/8-2026). Valget claimet returnerer (#422) er læst i samme atomiske
    // skrivning som stoppet — et valg truffet i web-appen siden sidste sync
    // gælder også her. Kun hvis vores eget valg endnu ikke er nået serveren,
    // vinder det. Opløsningen sker synkront mod kortene hentet før claim, så
    // der ikke ligger netværk mellem claim og write-ahead-køen. Et pinnet
    // kort der ikke kan honoreres erstattes ALDRIG tavst af auto-kortet: der
    // gemmes uden træk, og advarslen vises i stop-kvitteringen.
    const prepaidChoice =
      (!choicePushPending &&
        fromServerChoice(claimedPrepaidChoice, stopClientId)) ||
      get().prepaidChoice;
    let prepaidPackageId: string | null = null;
    let prepaidWarning: string | null = null;
    if (stopClientId && prepaidChoice.mode !== "none") {
      if (prefetchedPackages) {
        const resolution = resolvePrepaidPackage(
          prepaidChoice,
          prefetchedPackages,
          stopClientId,
        );
        prepaidPackageId = resolution.pkg?.id ?? null;
        if (resolution.pinnedUnavailable) {
          prepaidWarning = t("errors.timer.prepaidPinnedUnavailable");
        }
      } else if (prepaidChoice.mode === "package") {
        prepaidWarning = t("errors.timer.prepaidLookupFailed");
      }
    }

    const timeEntryData = {
      projectId: stopProjectId || undefined,
      clientId: stopClientId || undefined,
      hours: Math.max(0.01, displayTime / 3600), // Minimum 0.01 hours
      description: stopDescription || "Timer fra extension",
      // En timer over midnat dateres efter starten (kl. 23 → 01 hører til
      // dagen den startede), som web-appens kalender viser den.
      date: formatLocalDate(startedAt),
      startTime: startedAt.toISOString(),
      endTime: stoppedAt.toISOString(),
      // Idempotency: ÉN nøgle for hele dette stop. Alle gentagelser — direkte,
      // uden klippekort og fra offline-køen — bruger den, så serveren aldrig
      // gemmer sessionen to gange.
      clientEntryId: crypto.randomUUID(),
      prepaidPackageId,
      // 2.6.0: én session ⇒ højst én post. Et gentaget gem (også fra
      // offline-køen) returnerer sessionens eksisterende post.
      ...(claimedSessionId ? { timerSessionId: claimedSessionId } : {}),
    };
    const { serverVersion: claimedVersion } = get();

    // Write-ahead: læg gemmet (og bekræftelsen af stoppet) i offline-køen
    // FØR netværkskaldet, med en frist. Lukkes popup'en midt i et langsomt
    // gem, afspiller baggrunden posten med samme clientEntryId — i stedet for
    // at sessionen bliver hængende som "stopping" og senere gemmes igen.
    let writeAheadIds: string[] = [];
    try {
      const orgId = await getSelectedOrgId();
      const notBefore = new Date(
        Date.now() + WRITE_AHEAD_GRACE_MS,
      ).toISOString();
      writeAheadIds = await enqueuePersisted([
        {
          type: "createTimeEntry",
          payload: orgId
            ? { ...timeEntryData, organizationId: orgId }
            : { ...timeEntryData },
          notBefore,
          group: timeEntryData.clientEntryId,
        },
        {
          type: "confirmStop",
          payload: {
            version: claimedVersion,
            ...sessionField(claimedSessionId),
          },
          notBefore,
          group: timeEntryData.clientEntryId,
        },
      ]);
    } catch (error) {
      console.warn("Kunne ikke lægge stop i offline-køen:", error);
    }
    const [writeAheadEntryId, writeAheadConfirmId] = writeAheadIds;

    // Step 2: Create the time entry. Fejler gemmet på en KLIPPEKORT-fejl
    // (fx kortet løb tørt med block-politik), må tiden aldrig sidde fast i
    // timeren: prøv igen uden kort-id (samme clientEntryId → idempotent),
    // gem tiden som normal tid, og sig det højt i kvitteringen.
    //
    // En timeout er IKKE en afvisning: serveren kan have gemt posten, uden at
    // svaret nåede frem. Før blev stoppet så annulleret, timeren kørte videre
    // med den oprindelige start, og næste stop gemte sessionen igen med en ny
    // nøgle (kunde A: 2-3 ens poster). Nu gentages gemmet med SAMME nøgle, og
    // kun en sikker afvisning (4xx) lader timeren køre videre.
    const outcome = await saveWithRetry(
      async () => {
        try {
          return await apiClient.createTimeEntry(timeEntryData);
        } catch (createError) {
          if (
            !timeEntryData.prepaidPackageId ||
            !isPrepaidDeductionError(createError)
          ) {
            throw createError;
          }
          const retryResult = await apiClient.createTimeEntry({
            ...timeEntryData,
            prepaidPackageId: null,
          });
          prepaidWarning = t("errors.timer.prepaidDeductionFailed");
          return retryResult;
        }
      },
      {
        // Skub fristen før hvert forsøg, så baggrunden aldrig afspiller
        // gemmet, mens popup'en selv arbejder på det.
        onBeforeAttempt: (attempt) =>
          attempt > 1
            ? deferPersisted(writeAheadIds, WRITE_AHEAD_GRACE_MS).catch(
                () => {},
              )
            : undefined,
        onUncertainFailure: (error, attempt) =>
          console.warn(`Gem af timer usikkert (forsøg ${attempt}):`, error),
      },
    );

    let prepaidDeduction: StopResult["prepaidDeduction"] = null;
    let pendingSave = false;
    if (outcome.status === "saved") {
      prepaidDeduction = outcome.result.prepaidDeduction ?? null;
      // Gemt og kvitteret — write-ahead-posterne skal ikke afspilles. Stoppet
      // bekræftes nedenfor med sin egen gentagelse/kø.
      await removePersisted(writeAheadIds).catch(() => {});
    } else if (outcome.status === "rejected") {
      // Serveren afviste med sikkerhed (intet er gemt). Annullér stoppet, så
      // timeren lever videre, og vis fejlen.
      const error = outcome.error;
      console.error("Failed to create time entry:", error);
      await removePersisted(writeAheadIds).catch(() => {});
      let alreadySaved = false;
      try {
        const { serverVersion: currentVersion } = get();
        const cancelResult = await apiClient.cancelStop(
          currentVersion,
          claimedSessionId,
        );
        // cancelStop bumper rækkens version — uden den fejler næste stop
        // med version_mismatch.
        if (cancelResult?.success && typeof cancelResult.version === "number") {
          set({ serverVersion: cancelResult.version });
        }
        // 2.6.0: sessionen ER gemt (fx et tidligere forsøg landede) —
        // serveren har afsluttet stoppet. Timeren må ikke køre videre.
        alreadySaved =
          !cancelResult?.success && cancelResult?.reason === "already_saved";
      } catch {
        // Best-effort cancel
      }
      if (alreadySaved) {
        set({
          timer: {
            isRunning: false,
            startTime: null,
            elapsedSeconds: 0,
            baseSeconds: 0,
            projectId: null,
            clientId: null,
            description: "",
            lastSyncedAt: null,
          },
          displayTime: 0,
          isSyncing: false,
          error: null,
          remoteStopping: false,
          prepaidChoice: { mode: "auto" },
          lastStopResult: {
            hours: timeEntryData.hours,
            projectName: projectName ?? null,
            clientName: clientName ?? null,
            prepaidDeduction: null,
            prepaidWarning: null,
            pendingSave: false,
          },
        });
        void persistPrepaidChoice({ mode: "auto" }, null, null);
        return;
      }
      set({
        isSyncing: false,
        error:
          error instanceof Error
            ? t("errors.timer.saveFailedWith", {
                reason: userErrorMessage(
                  error,
                  t("errors.timer.unknownReason"),
                ),
              })
            : t("errors.timer.saveFailed"),
      });
      return;
    } else {
      // Usikkert udfald efter alle forsøg: sessionen ligger allerede i køen
      // med samme clientEntryId. Frigiv den til baggrunden med det samme, og
      // stop timeren som normalt — at genoptage den ville skabe en dublet.
      pendingSave = true;
      Sentry.captureMessage("Timer-stop: gem ubekræftet, lagt i offline-kø", {
        level: "warning",
        tags: { kind: "stop_save_unconfirmed" },
        extra: {
          attempts: outcome.attempts,
          error:
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error),
        },
      });
      // Review P1: bekræftelsen af stoppet bliver liggende i køen BAG gemmet
      // (samme group) og afspilles først, når gemmet er landet. En straks-
      // bekræftelse ville markere sessionen gemt uden post, og køens gem
      // skulle så gætte, hvilken post der gemte den.
      if (writeAheadEntryId) {
        await releasePersisted(
          writeAheadConfirmId
            ? [writeAheadEntryId, writeAheadConfirmId]
            : [writeAheadEntryId],
        ).catch(() => {});
      } else {
        // Write-ahead fejlede — læg gem + bekræftelse i køen nu (samme
        // nøgle). At genoptage timeren ville give en dublet, hvis serveren
        // nåede at gemme.
        const orgId = await getSelectedOrgId();
        const payload = orgId
          ? { ...timeEntryData, organizationId: orgId }
          : { ...timeEntryData };
        const actions = [
          {
            type: "createTimeEntry" as const,
            payload,
            group: timeEntryData.clientEntryId,
          },
          {
            type: "confirmStop" as const,
            payload: {
              version: claimedVersion,
              ...sessionField(claimedSessionId),
            },
            group: timeEntryData.clientEntryId,
          },
        ];
        await enqueuePersisted(actions).catch(() => {
          for (const action of actions) {
            useOfflineStore.getState().addToQueue(action);
          }
        });
      }
    }

    // Capture stop result for toast notification
    const stopResult: StopResult = {
      hours: timeEntryData.hours,
      projectName: projectName ?? null,
      clientName: clientName ?? null,
      prepaidDeduction,
      prepaidWarning,
      pendingSave,
    };

    // Step 3: Confirm stop (clears timer state on server). The entry IS saved
    // at this point — if confirm never lands, the server row stays "running"
    // with the old startTime, and a later stop would double-count the already
    // saved session. So: retry with backoff, and if it still fails, queue the
    // confirm for replay by the background sync (the server's version check
    // makes a late replay safe — it can never clear a newer timer session).
    let versionForConfirm = get().serverVersion;
    // Et usikkert gem bekræftes af køen, når gemmet er landet (se ovenfor)
    let confirmed = pendingSave;
    for (let attempt = 0; attempt < 4 && !confirmed; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
        const confirmResult = await apiClient.confirmStop(
          versionForConfirm,
          claimedSessionId,
        );
        if (confirmResult.success) {
          confirmed = true;
          if (confirmResult.version) {
            set({ serverVersion: confirmResult.version });
          }
        } else if (
          confirmResult.reason === "version_mismatch" &&
          typeof confirmResult.version === "number"
        ) {
          // Our stop is still pending but another write bumped the row version
          // while we were saving. Re-issue with the server's current version —
          // giving up here would leave the row stuck in "stopping" with the
          // already-saved session, which later gets resurrected and
          // double-counted.
          versionForConfirm = confirmResult.version;
        } else {
          // no_timer / not_stopping / wrong_source: the intent is already gone
          // or owned elsewhere — nothing left for us to confirm, don't queue.
          confirmed = true;
        }
      } catch (confirmError) {
        console.error(
          `Failed to confirm stop (attempt ${attempt + 1}):`,
          confirmError,
        );
      }
    }
    if (!confirmed) {
      // Hand over to the background offline queue so the confirm survives
      // popup close / network recovery.
      const payload = {
        version: versionForConfirm,
        ...sessionField(claimedSessionId),
      };
      await enqueuePersisted([{ type: "confirmStop", payload }]).catch(() => {
        useOfflineStore.getState().addToQueue({ type: "confirmStop", payload });
      });
    }

    set({
      timer: {
        isRunning: false,
        startTime: null,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: null,
        clientId: null,
        description: "",
        lastSyncedAt: null,
      },
      displayTime: 0,
      isSyncing: false,
      error: null,
      lastStopResult: stopResult,
      remoteStopping: false,
      prepaidChoice: { mode: "auto" },
    });
    void persistPrepaidChoice({ mode: "auto" }, null, null);
  },

  stopAndStart: async (next, current) => {
    await get().stopTimer(current.projectName, current.clientName);
    const { timer, displayTime, error } = get();
    // Lykkedes stoppet ikke, står den gamle session stadig — start ikke en
    // ny oven i den.
    if (error || timer?.isRunning || displayTime > 0) return;
    const start = () =>
      get().startTimer(next.projectId, next.clientId, next.description ?? "");
    await start();
    // Kom bekræftelsen af stoppet ikke igennem (den ligger i køen), kan
    // serveren stadig se fx web-appens timer som kørende og afvise starten.
    // Få baggrunden til at afspille køen nu, og prøv én gang til.
    if (get().error && !get().timer?.isRunning) {
      try {
        await chrome.runtime.sendMessage({ type: "PROCESS_OFFLINE_QUEUE" });
      } catch {
        // Baggrunden svarer ikke — fejlen fra første forsøg står
      }
      set({ error: null });
      await start();
    }
  },

  cancelTimer: async () => {
    await afterDescriptionWrite();
    if (get().isSyncing) return;
    const { timer, serverVersion } = get();
    if (!timer) return;

    writeSeq++;
    set({ isSyncing: true, error: null });

    // Claim timer for stop, then confirm without creating a time entry
    let claimedSessionId: string | null = timer.sessionId ?? null;
    try {
      const claimResult = await apiClient.claimForStop(
        serverVersion,
        timer.sessionId,
      );
      if (!claimResult.success && claimResult.reason === "session_mismatch") {
        set({ isSyncing: false });
        await get().fetchTimerState();
        set({ error: adoptMessage("session_mismatch") });
        return;
      }
      if (!claimResult.success) {
        set({
          isSyncing: false,
          error:
            claimResult.reason === "already_stopping"
              ? t("errors.timer.cancelStoppingElsewhere", {
                  source: t(
                    claimResult.stoppedBy === "web"
                      ? "errors.timer.sourceWeb"
                      : "errors.timer.sourceOther",
                  ),
                })
              : t("errors.timer.cancelFailed"),
          serverVersion: claimResult.version,
        });
        return;
      }
      claimedSessionId = claimResult.sessionId ?? claimedSessionId;
      set({ serverVersion: claimResult.version });
    } catch (claimError) {
      console.error("Failed to claim timer for cancel:", claimError);
      set({
        isSyncing: false,
        error: t("errors.timer.cancelNetwork"),
      });
      return;
    }

    // Confirm stop without creating a time entry
    try {
      const { serverVersion: currentVersion } = get();
      const confirmResult = await apiClient.confirmStop(
        currentVersion,
        claimedSessionId,
      );
      if (confirmResult.success && confirmResult.version) {
        set({ serverVersion: confirmResult.version });
      }
    } catch (confirmError) {
      console.error("Failed to confirm cancel:", confirmError);
    }

    // Always clear local state
    set({
      timer: {
        isRunning: false,
        startTime: null,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: null,
        clientId: null,
        description: "",
        lastSyncedAt: null,
      },
      displayTime: 0,
      isSyncing: false,
      prepaidChoice: { mode: "auto" },
    });
    void persistPrepaidChoice({ mode: "auto" }, null, null);
  },

  pauseTimer: async () => {
    await afterDescriptionWrite();
    if (get().isSyncing) return;
    const { timer, displayTime } = get();
    if (!timer?.isRunning) return;

    writeSeq++;
    set({ isSyncing: true, error: null });

    try {
      const timerState = await apiClient.updateTimerState({
        isRunning: false,
        startTime: null,
        baseSeconds: displayTime,
        elapsedSeconds: displayTime,
        ...sessionField(timer.sessionId),
      });
      if (adoptIfNotLanded(timerState)) return;

      // Session-nøglen (startTime) ændrer sig ved pause — re-nøgl valget
      const choice = get().prepaidChoice;
      if (choice.mode !== "auto") {
        void persistPrepaidChoice(
          choice,
          timerState.clientId ?? null,
          timerState.startTime ?? null,
        );
      }

      set({
        timer: timerState,
        displayTime,
        isSyncing: false,
        error: null,
        serverVersion: timerState.version ?? get().serverVersion,
      });
    } catch (error) {
      set({
        isSyncing: false,
        error: userErrorMessage(error, t("errors.timer.pauseFailed")),
      });
    }
  },

  resumeTimer: async () => {
    await afterDescriptionWrite();
    if (get().isSyncing) return;
    const { timer, displayTime } = get();
    if (!timer || timer.isRunning) return;

    writeSeq++;
    set({ isSyncing: true, error: null });

    try {
      // Send sekunderne eksplicit: serverens updateTimerState er et partielt
      // merge, så et genoptag må aldrig arve en ukendt/ældre baseSeconds fra
      // rækken — kun den tid brugeren kan se på pause-skærmen.
      const timerState = await apiClient.updateTimerState({
        isRunning: true,
        startTime: new Date().toISOString(),
        baseSeconds: displayTime,
        elapsedSeconds: displayTime,
        ...sessionField(timer.sessionId),
      });
      if (adoptIfNotLanded(timerState)) return;

      // Session-nøglen (startTime) ændrer sig ved genoptag — re-nøgl valget
      const choice = get().prepaidChoice;
      if (choice.mode !== "auto") {
        void persistPrepaidChoice(
          choice,
          timerState.clientId ?? null,
          timerState.startTime ?? null,
        );
      }

      set({
        timer: timerState,
        isSyncing: false,
        error: null,
        serverVersion: timerState.version ?? get().serverVersion,
      });
    } catch (error) {
      set({
        isSyncing: false,
        error: userErrorMessage(error, t("errors.timer.resumeFailed")),
      });
    }
  },

  addMinutes: async (minutes: number) => {
    const { timer, displayTime } = get();
    if (!timer || minutes <= 0) return;
    // `timer` er ikke null efter et stop — uden den her guard ville et klik
    // genoplive en ryddet række som en fantom-timer uden projekt/kunde.
    if (!canQuickAdd({ isRunning: timer.isRunning, displayTime })) return;
    writeSeq++;

    // Optimistisk: bump BÅDE displayTime og timer.baseSeconds med det samme.
    // Kun displayTime ville være nok i ét tick — `tick()` regner den om fra
    // baseSeconds hvert sekund og ville kaste bumpet væk igen.
    set((state) => {
      const current = state.timer;
      if (!current) return state;
      const next = buildQuickAddPayload({
        baseSeconds: current.baseSeconds || 0,
        displayTime: state.displayTime,
        minutes,
      });
      return {
        ...state,
        error: null,
        displayTime: next.elapsedSeconds,
        timer: {
          ...current,
          baseSeconds: next.baseSeconds,
          elapsedSeconds: next.elapsedSeconds,
        },
      };
    });

    try {
      await quickAddQueue.add(minutes);
    } catch (error) {
      set({
        error: userErrorMessage(error, t("errors.timer.addTimeFailed")),
      });
      // Serveren er sandheden når skrivningen fejlede — hent den, så det
      // optimistiske bump ikke bliver hængende som en løgn i displayet.
      void get().fetchTimerState();
    }
  },

  updateDescription: async (description: string) => {
    // Er en anden skrivning i gang (fx en start), ventes der på den — ellers
    // ville den skrevne tekst gå tabt.
    if (get().isSyncing) await waitUntilIdle();
    const { timer, displayTime } = get();
    // En inaktiv timer har ingen session at skrive til — beskrivelsen
    // sendes med i starten i stedet (#13).
    if (!timer || (!timer.isRunning && displayTime <= 0)) return;
    if (get().isSyncing) return;
    const seq = ++writeSeq;
    set({ error: null });

    // Gemningerne kædes: den næste sendes først, når den forrige er besvaret,
    // så et sent svar aldrig lander oven på et nyere — og stop/pause/skift
    // venter på hele kæden via afterDescriptionWrite.
    const previous = descriptionWrite;
    const write = (async () => {
      if (previous) await previous.catch(() => {});
      try {
        const timerState = await apiClient.updateTimerState({
          description,
          ...sessionField(timer.sessionId),
        });
        // Er der skrevet lokalt siden (en nyere beskrivelse eller et stop),
        // er svaret forældet og må ikke erstatte den nyere tilstand.
        if (writeSeq !== seq) return;
        if (adoptIfNotLanded(timerState)) return;
        set({
          timer: timerState,
          error: null,
          serverVersion: timerState.version ?? get().serverVersion,
        });
      } catch (error) {
        set({
          error: userErrorMessage(error, t("errors.timer.descriptionFailed")),
        });
      }
    })();
    descriptionWrite = write;
    try {
      await write;
    } finally {
      if (descriptionWrite === write) descriptionWrite = null;
    }
  },

  updateProject: async (projectId: string | null, clientId: string | null) => {
    await afterDescriptionWrite();
    const previousClientId = get().timer?.clientId ?? null;
    writeSeq++;
    set({ isSyncing: true, error: null });

    try {
      const timerState = await apiClient.updateTimerState({
        projectId,
        clientId,
        ...sessionField(get().timer?.sessionId),
      });
      if (adoptIfNotLanded(timerState)) return;
      // Ny kunde → klippekort-valget hører til den gamle og nulstilles
      if ((timerState.clientId ?? null) !== previousClientId) {
        void persistPrepaidChoice({ mode: "auto" }, null, null);
        set({ prepaidChoice: { mode: "auto" } });
      }
      set({
        timer: timerState,
        isSyncing: false,
        error: null,
        serverVersion: timerState.version ?? get().serverVersion,
      });
    } catch (error) {
      set({
        isSyncing: false,
        error: userErrorMessage(error, t("errors.timer.projectFailed")),
      });
    }
  },

  updateClient: async (clientId: string | null) => {
    await afterDescriptionWrite();
    const previousClientId = get().timer?.clientId ?? null;
    writeSeq++;
    set({ isSyncing: true, error: null });

    try {
      const timerState = await apiClient.updateTimerState({
        clientId,
        ...sessionField(get().timer?.sessionId),
      });
      if (adoptIfNotLanded(timerState)) return;
      // Ny kunde → klippekort-valget hører til den gamle og nulstilles
      if ((timerState.clientId ?? null) !== previousClientId) {
        void persistPrepaidChoice({ mode: "auto" }, null, null);
        set({ prepaidChoice: { mode: "auto" } });
      }
      set({
        timer: timerState,
        isSyncing: false,
        error: null,
        serverVersion: timerState.version ?? get().serverVersion,
      });
    } catch (error) {
      set({
        isSyncing: false,
        error: userErrorMessage(error, t("errors.timer.clientFailed")),
      });
    }
  },

  tick: () => {
    const { timer } = get();
    if (!timer?.isRunning) return;

    const displayTime = calculateDisplayTime(timer);
    set({ displayTime });
  },
}));

// Efter en timerhandling fra popup eller ny fane synker baggrunden straks
// (TIMER_CHANGED). Handlinger, der kalder hinanden (stopAndStart), giver kun
// én besked, når den yderste er færdig.
const NOTIFYING_ACTIONS = [
  "startTimer",
  "stopTimer",
  "stopAndStart",
  "cancelTimer",
  "pauseTimer",
  "resumeTimer",
  "addMinutes",
  "updateProject",
  "updateClient",
] as const;
let actionDepth = 0;
for (const name of NOTIFYING_ACTIONS) {
  const action = useTimerStore.getState()[name] as (
    ...args: unknown[]
  ) => Promise<unknown>;
  useTimerStore.setState({
    [name]: async (...args: unknown[]) => {
      actionDepth++;
      try {
        return await action(...args);
      } finally {
        actionDepth--;
        if (actionDepth === 0) notifyTimerChanged();
      }
    },
  });
}

function calculateDisplayTime(timer: TimerState | null): number {
  return displayTimeFor(timer, Date.now());
}
