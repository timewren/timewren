"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { sharedT } from "@/i18n/shared-text";
import { webClientHeaders } from "@/lib/client-version/browser";
import {
  isNetworkError,
  OFFLINE_QUEUE_DRAINED_EVENT,
} from "@/lib/offline/queue";
import type { DataChangeMessage } from "@/lib/query/cross-tab";
import {
  invalidateDomains,
  remoteInvalidatorFor,
  TIME_ENTRY_DOMAINS,
} from "@/lib/query/invalidate-domains";
import { getTabId } from "@/lib/query/tab-id";
import { pollBackoffMs } from "@/lib/timer/backoff";
import {
  isPureKeepAlive,
  observerKeepAliveDecision,
  sawOwnerActivity,
} from "@/lib/timer/heartbeat-observer";
import {
  heartbeatExpectedVersion,
  normalizeDetails,
  sameDetails,
  type TimerDetails,
} from "@/lib/timer/heartbeat-version";
import {
  decideAlreadyRunningAction,
  decidePersistedRunningOnMount,
  shouldAcceptMirrorReanchor,
  shouldHoldUnsyncedSelection,
  type TimerSelection,
} from "@/lib/timer/reconcile";
import {
  createServerConfirmation,
  type ServerConfirmation,
} from "@/lib/timer/server-confirmation";
import {
  shouldSendBackgroundTimerWrite,
  shouldTakeOverOnHandover,
} from "@/lib/timer/tab-owner";
import {
  beginStopClaim,
  type ClaimSnapshot,
  decideDedupedStart,
  isOwnLandedStart,
  isStillStopTarget,
  isStopClaimInFlight,
  type StopTarget,
  startNeverLanded,
} from "@/lib/timer/web-session";
import { trpc } from "@/providers/trpc-provider";
import {
  enqueueOfflineStart,
  shouldQueueTimerWrites,
  useOfflineQueueStore,
} from "@/stores/offlineQueueStore";
import { useTimerStore } from "@/stores/timerStore";
import { useTimerElectricSync } from "./useTimerElectricSync";
import { useTimerRealtime } from "./useTimerRealtime";
import { useTimerTabOwner } from "./useTimerTabOwner";

const SYNC_INTERVAL_MS = 30000; // 30 seconds
const POLL_INTERVAL_MS = 10000; // 10 seconds - check for external changes (reduced from 5s)
const RUNNING_POLL_INTERVAL_MS = 15000; // 15 seconds - check for stops from extension while running (reduced from 10s)

/** Current elapsed seconds implied by a server timer row (base + live session),
 *  capped to 24h. Mirrors the adoption branch's computation. */
function elapsedFromServer(sd: {
  startTime?: string | number | null;
  baseSeconds?: number | null;
  elapsedSeconds?: number | null;
}): number {
  let elapsed = sd.elapsedSeconds || 0;
  if (sd.startTime) {
    const start =
      typeof sd.startTime === "string"
        ? new Date(sd.startTime).getTime()
        : sd.startTime;
    const session = Math.max(0, Math.floor((Date.now() - start) / 1000));
    elapsed = (sd.baseSeconds || 0) + Math.min(session, 86400);
  }
  return Math.max(0, Math.min(elapsed, 86400));
}

export function useTimerSync() {
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncRef = useRef<string | null>(null);
  const lastCheckRef = useRef<number>(0); // Rate limit server checks
  const isSyncingRef = useRef(false);
  // Er den lokale kørende session bekræftet af serveren? En frisk start
  // sendes som isFreshStart; når en sync med isRunning lykkes, er sessionen
  // etableret. Indtil da sendes ALLE syncs som fresh start — ellers bliver
  // en tabt/fejlet etablerings-sync til et heartbeat mod en tom række, som
  // serveren (korrekt) afviser med not_running → lokal timer nulstilles
  // ~30–60 s efter start ("timeren stopper af sig selv", kunde A 1/9).
  const sessionEstablishedRef = useRef(false);
  // ENHVER sync der ramte isSyncing-låsen må ikke tabes — kør den igen så
  // snart den igangværende sync er færdig. Gjaldt tidligere kun fresh starts,
  // men en pauset timer har intet heartbeat der reparerer en tabt skrivning
  // (fx tre hurtige klik på "+15" mens en sync er i luften).
  const pendingSyncRef = useRef({ pending: false, isFreshStart: false });
  const hasCheckedRecoveryRef = useRef(false);
  // En kørende timer genindlæst fra localStorage ved sideindlæsning er IKKE
  // en brugerhandling. Indtil den er afstemt med serveren, må intet sendes —
  // ellers går den forældede session (gammel start, gammel kunde) til
  // serveren som fresh start og genopstår efter et stop et andet sted
  // (kunde A 1/10). Sat af start-effekten ved første kørsel, ryddet af
  // checkAndRecoverFromServer.
  const mountCheckedRef = useRef(false);
  const pendingMountReconcileRef = useRef(false);
  // Projekt/kunde ændret lokalt på en kørende timer, men endnu ikke bekræftet
  // af serveren. Mirror-grenen må ikke rulle den tilbage imens (kunde A 1/10).
  const unsyncedSelectionRef = useRef<TimerSelection | null>(null);
  // Sand mens vi selv lægger SERVERENS tilstand ind i store'en — så
  // store-abonnementet ikke opfatter det som en lokal ændring.
  const applyingServerStateRef = useRef(false);
  const wasRunningRef = useRef(false); // Track previous running state
  // Set when we just adopted the server's running timer, so the next sync can
  // take ownership without tripping the server's one-running-timer guard.
  const isAdoptionRef = useRef(false);
  const serverVersionRef = useRef<number>(0); // Track server version
  const consecutiveFailuresRef = useRef(0); // Track consecutive sync failures
  // Efter gentagne sync-fejl venter pollingen eksponentielt (maks. 5 min) —
  // men giver aldrig op. 0 = ingen ventetid.
  const pollBackoffUntilRef = useRef(0);
  // Forward ref to checkAndRecoverFromServer (defined later) so syncToServer
  // can trigger a reconcile without a circular useCallback dependency.
  const checkAndRecoverFromServerRef = useRef<
    ((opts?: { immediate?: boolean }) => Promise<void>) | null
  >(null);
  // Timer-sessioner (docs/architecture/timer-sessions.md): idempotensnøglen
  // på en NY start står i timerStore.startOpId (persisteret). Den genbruges på
  // hvert genforsøg (tabt svar) — serveren genkender den og svarer med
  // sessionen i stedet for at starte igen (#786) — og bæres af alle andre
  // skrivninger, indtil sessionens id kendes. Ryddes når serveren har svaret.
  // Vores egen start er landet (dedup/afstemning), men detaljerne kan være
  // ændret på en anden enhed imens: næste afstemning overtager serverens
  // projekt/kunde/beskrivelse i stedet for at skubbe vores egne (#786).
  const adoptOwnSessionDetailsRef = useRef(false);
  // Rækkens version da vi lærte vores sessionId. En afstemning med en ÆLDRE
  // version (svar der var undervejs før vores start landede) må ikke tolkes
  // som "sessionen er væk".
  const sessionKnownVersionRef = useRef(0);

  const { isRunning } = useTimerStore();

  const queryClient = useQueryClient();
  // Detaljerne (projekt/kunde/opgave/beskrivelse) serveren sidst bekræftede
  // eller viste os. Er de lokale lig med dem, er et heartbeat et rent
  // keep-alive og sendes med versionstjek (se lib/timer/heartbeat-version).
  const lastServerDetailsRef = useRef<TimerDetails | null>(null);
  // Observatør (lib/timer/heartbeat-observer): fanens keep-alive tabte til en
  // anden aktiv skriver (version_conflict). Den viser timeren, men sender ikke
  // keep-alive, før brugeren ændrer noget lokalt eller ejeren er væk.
  const observerRef = useRef(false);
  // Fanens ur da en afstemning sidst så en fremmed skrivning.
  const ownerSeenAtRef = useRef(0);
  // Rækkens lastSyncedAt (ms) ved sidste afstemning.
  const serverLastSyncedAtRef = useRef<number | null>(null);
  // Hvornår en afstemning sidst faktisk hentede serverens tilstand.
  const lastFreshReadAtRef = useRef(0);
  // Starttiden på serverens kørende session ved sidste afstemning — et skift
  // betyder at en session er stoppet+gemt og en ny startet et andet sted.
  const prevServerStartRef = useRef<number | null>(null);
  // Tracks whether the server timer was running/stopping on the previous
  // reconcile, so we can detect a remote stop (running → stopped) and refresh
  // the data a cross-client save produced (new entry, klippekort balance…).
  const prevServerRunningRef = useRef(false);
  // Reconcile re-entrancy lock + one queued follow-up for realtime signals
  // that arrive while a reconcile is already in flight.
  const isReconcilingRef = useRef(false);
  const pendingReconcileRef = useRef(false);
  // Serverens bekræftelse af fanens kørende timer siden seneste genindlæsning
  // eller fokus (#1324). Påmindelsen om en lang timer bruger kun den.
  const serverConfirmationRef = useRef<ServerConfirmation | null>(null);
  if (!serverConfirmationRef.current) {
    serverConfirmationRef.current = createServerConfirmation();
  }
  const serverConfirmation = serverConfirmationRef.current;

  // Ejerskab af denne fanes baggrunds-skrivninger (lib/timer/tab-owner.ts).
  // Læst synkront fra callbacks/intervaller via en ref, så den ikke tvinger
  // syncToServer til at blive genskabt (og dermed genstarte heartbeat-
  // intervallet) hver gang ejerskabet skifter.
  const { isOwner, handover: ownershipHandover } = useTimerTabOwner();
  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;

  const syncMutation = trpc.timerSync.sync.useMutation();
  const syncMutateRef = useRef(syncMutation.mutateAsync);
  syncMutateRef.current = syncMutation.mutateAsync;
  const clearMutation = trpc.timerSync.clear.useMutation();
  const claimForStopMutation = trpc.timerSync.claimForStop.useMutation();
  const confirmStopMutation = trpc.timerSync.confirmStop.useMutation();
  const cancelStopMutation = trpc.timerSync.cancelStop.useMutation();

  // Query for checking server state - used for recovery and polling
  const { refetch: refetchServerState } = trpc.timerSync.getState.useQuery(
    undefined,
    {
      enabled: false, // Manual fetch only
      staleTime: 0,
    },
  );

  // Sync current state to server
  // Reads from store directly to avoid recreating on every tick/keystroke
  // `isFreshStart` is set only when the user just started a brand-new timer,
  // so the server can reject it if another client is already running one.
  // Offline-kø (#703): en session serveren aldrig har set, lægges i køen som
  // én køet start (med idempotensnøgle) i stedet for at gå tabt eller blive
  // genoptaget af heartbeats i tilfældig rækkefølge efter reconnect.
  const queueStartIfUnestablished = useCallback(() => {
    const state = useTimerStore.getState();
    if (
      !state.isRunning ||
      isAdoptionRef.current ||
      sessionEstablishedRef.current ||
      state.startTime === null ||
      state.sessionStartTime === null
    ) {
      return;
    }
    // Samme nøgle som de online forsøg: lander starten både online (tabt
    // svar) og fra køen, er det én start.
    if (state.sessionId) return;
    const opId = state.startOpId ?? crypto.randomUUID();
    if (!state.startOpId) useTimerStore.getState().setStartOpId(opId);
    enqueueOfflineStart(
      {
        startTime: state.startTime,
        sessionStartTime: state.sessionStartTime,
        elapsedSeconds: state.elapsedTime,
        baseSeconds: state.baseTime,
        projectId: state.projectId || null,
        clientId: state.clientId || null,
        taskId: state.taskId || null,
        description: state.description,
      },
      opId,
    );
  }, []);

  const syncToServer = useCallback(
    async (opts?: { isFreshStart?: boolean; background?: boolean }) => {
      // Genindlæst kørende timer, endnu ikke afstemt: intet sendes (heller
      // ikke til offline-køen) — afstemningen afgør om den er gyldig.
      if (pendingMountReconcileRef.current) return;
      // Kun ejer-fanen sender automatiske baggrunds-skrivninger (adoption-
      // write, 30s-heartbeat). Brugerhandlinger (background ikke sat) sendes
      // altid, fra alle faner — se lib/timer/tab-owner.ts.
      if (
        !shouldSendBackgroundTimerWrite({
          background: !!opts?.background,
          isOwner: isOwnerRef.current,
        })
      ) {
        return;
      }
      // Offline, eller køen har stadig ventende ændringer: intet må overhale
      // dem. Køen afspilles i rækkefølge, og synken tager over bagefter.
      if (shouldQueueTimerWrites()) {
        queueStartIfUnestablished();
        return;
      }
      // Observatør: et rent keep-alive sendes ikke, mens en anden skriver
      // holder timeren i live. Er ejeren ikke set i et stykke tid, afstemmes
      // der først — er den stadig væk, overtager fanen keep-alive igen.
      if (observerRef.current && !opts?.isFreshStart) {
        const decide = () => {
          const s = useTimerStore.getState();
          return observerKeepAliveDecision({
            observer: observerRef.current,
            pureKeepAlive: isPureKeepAlive({
              isRunning: s.isRunning,
              isFreshStart: false,
              sessionEstablished: sessionEstablishedRef.current,
              lastServerDetails: lastServerDetailsRef.current,
              local: normalizeDetails(s),
              hasUnsyncedSelection: unsyncedSelectionRef.current !== null,
            }),
            ownerSeenAt: ownerSeenAtRef.current,
            now: Date.now(),
          });
        };
        const decision = decide();
        if (decision === "skip") return;
        if (decision === "check-owner") {
          const checkedAt = Date.now();
          lastCheckRef.current = 0;
          await checkAndRecoverFromServerRef.current?.({ immediate: true });
          // Ingen frisk læsning (en anden afstemning var i gang, eller
          // hentningen fejlede): intet bevis for at ejeren er væk — prøv
          // igen ved næste tik i stedet for at risikere en ny konflikt.
          if (lastFreshReadAtRef.current < checkedAt) return;
          // Ejeren lever alligevel, eller afstemningen ændrede tilstanden
          // (stop/pause et andet sted) — så er der intet keep-alive at sende.
          if (decide() !== "check-owner") return;
          console.log(
            "[Timer Sync] Ingen anden skriver set i 2 min — fanen genoptager keep-alive",
          );
          observerRef.current = false;
        }
      }
      if (isSyncingRef.current) {
        pendingSyncRef.current.pending = true;
        if (opts?.isFreshStart) pendingSyncRef.current.isFreshStart = true;
        return;
      }

      isSyncingRef.current = true;
      try {
        const state = useTimerStore.getState();
        // Adoption is read (not cleared) here so a sync skipped by the
        // isSyncing guard doesn't lose the flag — the next sync that actually
        // reaches the server completes the ownership takeover. A fresh start
        // is never an adoption.
        const isAdoption = !opts?.isFreshStart && isAdoptionRef.current;
        // Sessionen er endnu ikke bekræftet af serveren → stadig en fresh
        // start, uanset om kaldet kommer fra heartbeat-intervallet.
        const isFreshStart =
          (opts?.isFreshStart ?? false) ||
          (state.isRunning && !isAdoption && !sessionEstablishedRef.current);
        const expectedVersion = heartbeatExpectedVersion({
          isRunning: state.isRunning,
          isFreshStart,
          isAdoption,
          sessionEstablished: sessionEstablishedRef.current,
          lastServerDetails: lastServerDetailsRef.current,
          local: normalizeDetails(state),
          serverVersion: serverVersionRef.current,
        });
        // En NY session (ingen server-session endnu, ingen tidligere tid)
        // startes med en idempotensnøgle, der genbruges indtil serveren har
        // svaret. Et genoptag af en pause bærer i stedet sessionens id.
        const isNewSessionStart =
          isFreshStart &&
          state.isRunning &&
          !state.sessionId &&
          state.baseTime === 0;
        let startOpId: string | null = null;
        if (isNewSessionStart) {
          startOpId = state.startOpId ?? crypto.randomUUID();
          if (!state.startOpId)
            useTimerStore.getState().setStartOpId(startOpId);
        }
        // Adoption og pause ændrer ikke projekt/kunde, når fanens kopi er den
        // serveren sidst bekræftede: et nyere skift fra en anden fane/enhed
        // må ikke overskrives af fanens forældede kopi.
        const keepDetails =
          (isAdoption ||
            (!state.isRunning &&
              (state.elapsedTime > 0 || state.baseTime > 0))) &&
          !!lastServerDetailsRef.current &&
          sameDetails(lastServerDetailsRef.current, normalizeDetails(state));
        // Ukendt id, men en start der måske landede: skrivningen bærer
        // startnøglen, så den kun rammer DEN session (aldrig en anden).
        const sessionOpId =
          !isNewSessionStart && !state.sessionId && state.startOpId
            ? state.startOpId
            : undefined;
        // Et tabt svar kaster herfra (catch nedenfor) — nøglen beholdes, så
        // genforsøget er samme start.
        const result = await syncMutateRef.current({
          isRunning: state.isRunning,
          startTime: state.startTime,
          sessionStartTime: state.sessionStartTime,
          elapsedSeconds: state.elapsedTime,
          baseSeconds: state.baseTime,
          projectId: state.projectId || null,
          clientId: state.clientId || null,
          taskId: state.taskId || null,
          description: state.description,
          source: "web",
          isFreshStart,
          isAdoption,
          expectedVersion,
          sessionId: state.sessionId ?? undefined,
          sessionOpId,
          keepDetails,
          clientOpId: startOpId ?? undefined,
          continuesEntryId:
            isNewSessionStart && state.continuingEntryId
              ? state.continuingEntryId
              : undefined,
        });
        // Serveren har svaret — nøglen er ikke længere sessionens eneste
        // identitet (id'et følger med svaret, eller starten er afvist).
        const opNow = useTimerStore.getState().startOpId;
        if (opNow && (opNow === startOpId || opNow === sessionOpId)) {
          useTimerStore.getState().setStartOpId(null);
        }

        // The server has answered — ownership is settled either way.
        isAdoptionRef.current = false;

        // Samme lokale session som da kaldet blev sendt? (Ellers er svaret om
        // en session vi allerede har forladt.)
        const sameLocalSession =
          useTimerStore.getState().sessionStartTime === state.sessionStartTime;

        // Reset failure counter on success
        consecutiveFailuresRef.current = 0;
        pollBackoffUntilRef.current = 0;

        if (result.success && "deduplicated" in result && result.deduplicated) {
          // Vores start var allerede landet (svaret på et tidligere forsøg
          // gik tabt). Kører den session stadig, overtager vi den — med
          // serverens detaljer, ikke vores egne (#786). Ellers er den afsluttet
          // et andet sted, og den lokale kopi droppes.
          const decision = decideDedupedStart(result);
          if (decision === "adopt-own" && sameLocalSession) {
            useTimerStore.getState().setSessionId(result.sessionId ?? null);
            sessionKnownVersionRef.current = 0;
            sessionEstablishedRef.current = true;
            adoptOwnSessionDetailsRef.current = true;
          } else if (sameLocalSession) {
            useTimerStore.getState().resetTimer();
          }
          lastCheckRef.current = 0;
          void checkAndRecoverFromServerRef.current?.({ immediate: true });
        } else if (result.success) {
          // Fanen har selv skrevet — den er (igen) en aktiv skriver.
          observerRef.current = false;
          // keepDetails: rækken beholdt sine detaljer, som kan være nyere end
          // fanens (et skift fra en anden fane/enhed) — spejl dem, så næste
          // heartbeat ikke skubber den forældede kopi tilbage.
          if (
            keepDetails &&
            sameLocalSession &&
            "details" in result &&
            result.details &&
            ((result.details.projectId ?? null) !==
              (useTimerStore.getState().projectId ?? null) ||
              (result.details.clientId ?? null) !==
                (useTimerStore.getState().clientId ?? null))
          ) {
            applyingServerStateRef.current = true;
            useTimerStore.setState({
              projectId: result.details.projectId,
              clientId: result.details.clientId,
              taskId: result.details.taskId,
              description: result.details.description,
            });
            applyingServerStateRef.current = false;
          }
          if (
            sameLocalSession &&
            "sessionId" in result &&
            result.sessionId &&
            (state.isRunning || state.elapsedTime > 0)
          ) {
            if (useTimerStore.getState().sessionId !== result.sessionId) {
              sessionKnownVersionRef.current = result.version ?? 0;
            }
            useTimerStore.getState().setSessionId(result.sessionId);
          }
          const unsynced = unsyncedSelectionRef.current;
          if (
            unsynced &&
            (unsynced.projectId || null) === (state.projectId || null) &&
            (unsynced.clientId || null) === (state.clientId || null)
          ) {
            unsyncedSelectionRef.current = null;
          }
          if (state.isRunning) {
            // Med keepDetails er serverens detaljer dem vi lige har spejlet
            lastServerDetailsRef.current =
              keepDetails && "details" in result && result.details
                ? normalizeDetails(result.details)
                : normalizeDetails(state);
            sessionEstablishedRef.current = true;
            useOfflineQueueStore
              .getState()
              .setEstablishedSession(state.sessionStartTime);
          }
          lastSyncRef.current = result.syncedAt ?? null;
          if (result.version !== undefined) {
            serverVersionRef.current = result.version;
            useOfflineQueueStore
              .getState()
              .setKnownServerVersion(result.version);
          }
        } else if (result.reason === "session_mismatch") {
          // Vores session er afsluttet (eller afløst) et andet sted. Intet er
          // skrevet. Drop den lokale kopi og adoptér serverens tilstand —
          // aldrig genoplive (timer-sessioner, fase 1).
          console.log("[Timer Sync] Sessionen findes ikke længere, afstemmer");
          if (result.version !== undefined) {
            serverVersionRef.current = result.version;
          }
          if (sameLocalSession) useTimerStore.getState().resetTimer();
          lastCheckRef.current = 0;
          void checkAndRecoverFromServerRef.current?.({ immediate: true });
        } else if (result.reason === "already_running") {
          // Der findes præcis ÉN timer-række pr. bruger, så det her er ALTID
          // brugerens egen timer — typisk fordi extensionen lige har skrevet
          // til rækken og dermed overtaget `lastSyncedFrom` (#589).
          console.log(
            "[Timer Sync] Start blocked, timer already running from",
            result.runningFrom,
          );
          if (result.version !== undefined) {
            serverVersionRef.current = result.version;
          }
          const runningName =
            result.running?.project?.name ||
            result.running?.client?.name ||
            result.running?.description ||
            sharedT("sharedLabels", "hooks.timerSync.otherProject");
          const blockedState = useTimerStore.getState();
          const action = decideAlreadyRunningAction({
            isFreshStart: opts?.isFreshStart === true,
            baseTime: blockedState.baseTime,
          });
          if (action === "adopt") {
            // ET HEARTBEAT MÅ ALDRIG NULSTILLE (#589): resetTimer() var netop
            // vejen til "timeren starter forfra" / 00:00:00-glimtet. Behold
            // den lokale elapsed og lad reconcile adoptere serverens tilstand.
            console.log(
              "[Timer Sync] Heartbeat blocked by other owner — adopting without reset",
              {
                localElapsed: blockedState.elapsedTime,
                runningFrom: result.runningFrom,
              },
            );
            isAdoptionRef.current = true;
            lastCheckRef.current = 0;
            void checkAndRecoverFromServerRef.current?.();
          } else if (action === "park-paused") {
            // A blocked RESUME of a paused timer (baseTime carries real,
            // possibly hours-long work) must not discard that time — put the
            // timer back in its paused state instead of resetting it.
            useTimerStore.setState({ isRunning: false, startTime: null });
            toast.error(
              sharedT("sharedLabels", "hooks.timerSync.runningPaused", {
                name: runningName,
              }),
            );
          } else {
            useTimerStore.getState().resetTimer();
            toast.error(
              sharedT("sharedLabels", "hooks.timerSync.running", {
                name: runningName,
              }),
            );
            // Pull in the running timer so the UI reflects the single active
            // timer. Clear the reconcile rate-limit first, otherwise a poll in
            // the last 2s makes checkAndRecoverFromServer return early and the
            // running timer wouldn't appear until the next poll.
            lastCheckRef.current = 0;
            void checkAndRecoverFromServerRef.current?.();
          }
        } else if (result.reason === "version_conflict") {
          // En anden fane/enhed (samme `source`) har skrevet til rækken siden
          // vi sidst så den. Vores keep-alive blev IKKE skrevet — afstem og
          // spejl de nyere detaljer i stedet for at overskrive dem.
          // Konflikten gentager sig hvert 30. sekund, så længe den anden
          // skriver er aktiv (fx en anden fane der også holder timeren i live).
          // Fanen bliver observatør i stedet for at kæmpe (kunde A 5/10).
          console.log(
            "[Timer Sync] Heartbeat-versionskonflikt — afstemmer og observerer",
          );
          observerRef.current = true;
          ownerSeenAtRef.current = Date.now();
          lastCheckRef.current = 0;
          void checkAndRecoverFromServerRef.current?.({ immediate: true });
        } else if (result.reason === "stopping_in_progress") {
          // Timer is being stopped by extension, stop local timer
          console.log(
            "[Timer Sync] Timer is being stopped by",
            result.stoppedBy,
          );
          useTimerStore.setState({
            isRunning: false,
            startTime: null,
            sessionStartTime: null,
          });
        } else if (result.reason === "adoption_stale") {
          // The timer we adopted was stopped/paused on the other client
          // before our takeover landed — drop the local copy quietly and
          // reconcile to the server's current state.
          console.log("[Timer Sync] Adoption stale, reconciling");
          if (result.version !== undefined) {
            serverVersionRef.current = result.version;
          }
          useTimerStore.setState({
            isRunning: false,
            startTime: null,
            sessionStartTime: null,
          });
          lastCheckRef.current = 0;
          void checkAndRecoverFromServerRef.current?.();
        } else if (
          result.reason === "not_running" ||
          result.reason === "not_active" ||
          result.reason === "stale_start"
        ) {
          // The server refused to let this heartbeat/pause revive a timer that
          // was stopped/cleared on another client. Drop the local copy and
          // reconcile — the time was already saved where the stop happened.
          console.log(
            "[Timer Sync] Server timer was stopped elsewhere, resetting local",
          );
          if (result.version !== undefined) {
            serverVersionRef.current = result.version;
          }
          if (
            ("staleStart" in result && result.staleStart) ||
            result.reason === "stale_start"
          ) {
            // Genopstandelses-guarden: denne session er allerede stoppet og
            // gemt (fx fra extensionen). Sig det i stedet for at lade
            // timeren forsvinde stille.
            toast.info(
              sharedT("sharedLabels", "hooks.timerSync.alreadyStopped"),
            );
          }
          useTimerStore.getState().resetTimer();
          lastCheckRef.current = 0;
          void checkAndRecoverFromServerRef.current?.();
        }
      } catch (error) {
        console.error("Timer sync failed:", error);
        if (isNetworkError(error)) queueStartIfUnestablished();
        consecutiveFailuresRef.current++;
        // Mange fejl i træk: vent eksponentielt længere med pollingen (maks.
        // 5 min), men prøv altid igen — tidligere stoppede den for altid.
        const wait = pollBackoffMs(consecutiveFailuresRef.current);
        if (wait > 0) {
          console.warn("[Timer Sync] Gentagne fejl, polling venter", wait);
          pollBackoffUntilRef.current = Date.now() + wait;
        }
      } finally {
        isSyncingRef.current = false;
        if (pendingSyncRef.current.pending) {
          const { isFreshStart } = pendingSyncRef.current;
          pendingSyncRef.current = { pending: false, isFreshStart: false };
          void syncToServerRef.current?.(
            isFreshStart ? { isFreshStart: true } : undefined,
          );
        }
      }
    },
    [queueStartIfUnestablished],
  );
  const syncToServerRef = useRef<typeof syncToServer | null>(null);
  syncToServerRef.current = syncToServer;

  // Clear server state
  const clearServerState = useCallback(
    async (sessionId?: string | null) => {
      try {
        // Med sessionen ryddes KUN den — en ny timer startet et andet sted
        // imens røres ikke.
        const result = await clearMutation.mutateAsync({
          source: "web",
          sessionId: sessionId ?? undefined,
        });
        lastSyncRef.current = null;
        if (result.version !== undefined) {
          serverVersionRef.current = result.version;
        }
      } catch (error) {
        console.error("Failed to clear server timer state:", error);
      }
    },
    [clearMutation],
  );

  // Claim timer for stop. Returnerer sessionens øjebliksbillede (truthy) ved
  // succes, ellers false.
  const claimTimerForStop = useCallback(async (): Promise<
    ClaimSnapshot | "unsynced" | false
  > => {
    // Stopmålet er sessionen ved klikket, læst FØR refetch'et (#1333): en
    // afstemning, der adopterer en anden session imens, må ikke gøre den til
    // målet.
    const clicked = useTimerStore.getState();
    const target = {
      sessionId: clicked.sessionId,
      sessionStartTime: clicked.sessionStartTime,
    };
    try {
      // Refetch the CURRENT server version right before claiming. The cached
      // serverVersionRef can lag an in-flight heartbeat's version bump, and a
      // claim with that stale version fails with a false "stopped from another
      // device" even though nobody else touched the timer.
      try {
        const fresh = await refetchServerState();
        if (fresh.data?.version !== undefined) {
          serverVersionRef.current = fresh.data.version;
        }
        // En start hvis svar gik tabt, men som landede: det er vores
        // session — claim den med dens id (timer-sessioner). Har vi
        // startnøglen, finder claimet sessionen med den i stedet (#1333):
        // en anden session startet inden for et sekund af vores ligner vores.
        const before = useTimerStore.getState();
        if (
          !before.sessionId &&
          !before.startOpId &&
          before.isRunning &&
          fresh.data?.isRunning &&
          fresh.data.sessionId &&
          isOwnLandedStart(fresh.data.startTime, before.startTime)
        ) {
          before.setSessionId(fresh.data.sessionId);
        }
      } catch {
        // Fall back to the cached version — worst case the claim reports
        // version_mismatch and the user retries.
      }

      const local = useTimerStore.getState();
      // Et id lært ovenfor er målets eget (samme lokale start).
      if (!isStillStopTarget(target, local, local.sessionId)) {
        console.log(
          "[Timer Sync] Fanen skiftede session, før stoppet blev claimet",
        );
        return false;
      }
      const endClaim = beginStopClaim();
      let result: Awaited<ReturnType<typeof claimForStopMutation.mutateAsync>>;
      try {
        result = await claimForStopMutation.mutateAsync({
          expectedVersion: serverVersionRef.current,
          source: "web",
          // Kun netop vores session må claimes (#788) — kendes id'et ikke
          // endnu (tabt svar på starten), så sessionen startnøglen oprettede
          sessionId: local.sessionId ?? undefined,
          sessionOpId:
            !local.sessionId && local.startOpId ? local.startOpId : undefined,
        });
      } finally {
        endClaim();
      }

      // Svaret kan lande efter, at afstemningen har adopteret en anden
      // session (#1333). Det hører til A og må hverken skrive oven i B,
      // nulstille den eller give den gem-dialog; versionen er også A's.
      if (
        !isStillStopTarget(
          local,
          useTimerStore.getState(),
          result.success ? result.sessionId : undefined,
        )
      ) {
        console.log(
          "[Timer Sync] Claim-svar for en session, fanen ikke længere kører",
        );
        if (result.success) {
          // Claimet lykkedes: frigiv det, bundet til den claimede session,
          // så rækken ikke står i "stopping", til cron'en parkerer den.
          try {
            const released = await cancelStopMutation.mutateAsync({
              version: result.version,
              source: "web",
              sessionId: result.sessionId ?? undefined,
            });
            if (released?.version !== undefined) {
              serverVersionRef.current = released.version;
            }
          } catch (error) {
            console.error("Failed to release stop claim:", error);
          }
        }
        return false;
      }

      if (result.success) {
        serverVersionRef.current = result.version;
        // Gem-dialogen bygger på sessionens øjebliksbillede fra serveren —
        // ikke fanens evt. forældede valg (#785). Lægges ind uden at det
        // tæller som en lokal ændring.
        const snapshot: ClaimSnapshot = {
          sessionId: result.sessionId ?? null,
          projectId: result.session.projectId,
          clientId: result.session.clientId,
          taskId: result.session.taskId,
          description: result.session.description,
          startedAt: result.session.startedAt,
        };
        applyingServerStateRef.current = true;
        useTimerStore.setState({
          sessionId: snapshot.sessionId,
          startOpId: null,
          projectId: snapshot.projectId,
          clientId: snapshot.clientId,
          taskId: snapshot.taskId ?? local.taskId,
          description: snapshot.description || local.description,
        });
        applyingServerStateRef.current = false;
        return snapshot;
      }

      if (startNeverLanded(result)) {
        // Starten nåede aldrig serveren: tiden findes kun her. Den gemmes via
        // offline-stoppet (gem-dialogen) i stedet for at blive smidt væk.
        return "unsynced";
      }
      if (result.reason === "session_mismatch") {
        // Vores session er stoppet/afløst et andet sted — drop den lokale
        // kopi, så den aldrig gemmes oven i en anden session (#788).
        useTimerStore.getState().resetTimer();
      }

      console.log(
        "[Timer Sync] Failed to claim timer for stop:",
        result.reason,
      );
      if (result.version !== undefined) {
        serverVersionRef.current = result.version;
      }
      return false;
    } catch (error) {
      console.error("Failed to claim timer for stop:", error);
      return false;
    }
  }, [claimForStopMutation, cancelStopMutation, refetchServerState]);

  // Confirm stop - called after saving time entry. `stoppedSessionId` is the
  // session the save dialog was opened for (#1333); the store may have
  // adopted another one since.
  const confirmStop = useCallback(
    async (stoppedSessionId?: string): Promise<boolean> => {
      const sessionId =
        stoppedSessionId ?? useTimerStore.getState().sessionId ?? undefined;
      try {
        // Bounded retry on version_mismatch: another write (e.g. a second
        // tab's heartbeat) can bump the row version between claim and confirm.
        // Giving up would leave the row stuck in "stopping" with the
        // already-saved session on it until the cleanup cron parks it.
        let version = serverVersionRef.current;
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await confirmStopMutation.mutateAsync({
            version,
            source: "web",
            sessionId,
          });

          if (result.success) {
            if (result.version !== undefined) {
              serverVersionRef.current = result.version;
              useOfflineQueueStore
                .getState()
                .setKnownServerVersion(result.version);
            }
            return true;
          }
          if (
            result.reason === "version_mismatch" &&
            typeof result.version === "number"
          ) {
            version = result.version;
            continue;
          }
          // no_timer / not_stopping / wrong_source: nothing left for us to
          // confirm.
          return false;
        }
        return false;
      } catch (error) {
        console.error("Failed to confirm stop:", error);
        return false;
      }
    },
    [confirmStopMutation],
  );

  // Cancel stop - called when user cancels from save modal.
  // "already_saved": posten blev gemt (svaret gik tabt) — sessionen er slut,
  // og timeren må IKKE køre videre (#783). Den lokale timer nulstilles her.
  // `stopTarget` er den stoppede session (#1333): fanen kan have skiftet til
  // en anden, mens gem-dialogen stod åben, og dens claim er ikke vores.
  const cancelStop = useCallback(
    async (
      stopTarget?: StopTarget | null,
    ): Promise<"cancelled" | "already_saved" | "failed"> => {
      try {
        const live = useTimerStore.getState();
        const result = await cancelStopMutation.mutateAsync({
          version: serverVersionRef.current,
          source: "web",
          sessionId:
            (stopTarget ? stopTarget.sessionId : live.sessionId) ?? undefined,
        });

        if (result.version !== undefined) {
          serverVersionRef.current = result.version;
        }
        if (result.success) return "cancelled";
        if (result.reason === "already_saved") {
          const now = useTimerStore.getState();
          if (
            !stopTarget ||
            isStillStopTarget(stopTarget, now, now.sessionId)
          ) {
            now.resetTimer();
          }
          void invalidateDomains(queryClient, TIME_ENTRY_DOMAINS);
          return "already_saved";
        }
        return "failed";
      } catch (error) {
        console.error("Failed to cancel stop:", error);
        return "failed";
      }
    },
    [cancelStopMutation, queryClient],
  );

  // Annullér et claim på vej ud af siden. Et forladt stop-claim (fanen lukkes
  // eller brugeren navigerer væk mens gem-dialogen står åben) efterlader
  // serverens timer i "stopping": extensionen viser den straks som stoppet
  // med 0 tid, og oprydnings-cron'en parker den som pauset fem minutter
  // senere — timeren "stopper af sig selv" (kunde A 28/8). En almindelig
  // mutation når ikke af sted under unload, så kaldet sendes som
  // keepalive-fetch direkte mod tRPC-endpointet.
  /**
   * Sidste udkald: skub den aktuelle tilstand med `keepalive`, så den
   * overlever at siden lukkes eller navigeres væk.
   *
   * Bruges når der lige er lagt tid til en timer der måske er pauset — en
   * pauset timer har intet heartbeat, og en almindelig fetch bliver afbrudt
   * midt i unload. Samme mønster som cancelStopOnUnload.
   */
  const syncOnUnload = useCallback(() => {
    try {
      const state = useTimerStore.getState();
      void fetch("/api/trpc/timerSync.sync", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: {
          "content-type": "application/json",
          ...webClientHeaders(),
        },
        body: JSON.stringify({
          json: {
            isRunning: state.isRunning,
            startTime: state.startTime,
            sessionStartTime: state.sessionStartTime,
            elapsedSeconds: state.elapsedTime,
            baseSeconds: state.baseTime,
            projectId: state.projectId || null,
            clientId: state.clientId || null,
            taskId: state.taskId || null,
            description: state.description,
            source: "web",
            isFreshStart: false,
            isAdoption: false,
            sessionId: state.sessionId ?? undefined,
          },
        }),
      }).catch(() => {});
    } catch {
      // Siden er på vej væk — næste heartbeat/reconcile retter op.
    }
  }, []);

  // Som cancelStop: bundet til den stoppede session (#1333).
  const cancelStopOnUnload = useCallback((stopTarget?: StopTarget | null) => {
    try {
      const sessionId = stopTarget
        ? stopTarget.sessionId
        : useTimerStore.getState().sessionId;
      void fetch("/api/trpc/timerSync.cancelStop", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: {
          "content-type": "application/json",
          ...webClientHeaders(),
        },
        body: JSON.stringify({
          json: {
            version: serverVersionRef.current,
            source: "web",
            sessionId: sessionId ?? undefined,
          },
        }),
      }).catch(() => {});
    } catch {
      // Siden er på vej væk — i værste fald parker cron'en claimet som pauset.
    }
  }, []);

  // Check server state and recover/sync if needed (e.g., timer started/stopped from extension)
  const checkAndRecoverFromServer = useCallback(
    async (opts?: { immediate?: boolean }) => {
      // Throttle POLLING to once per 2s, but let realtime signals (Electric/SSE)
      // through immediately. Those are precise change events — dropping one
      // because a poll ran <2s ago would delay the sync until the next 10-15s
      // poll (the "5 second" lag). Instant cross-instance state is the whole
      // point of Electric, so realtime callers pass immediate: true.
      // Offline-kø (#703): mens køen har ventende ændringer, er serveren
      // bagud i forhold til den lokale sandhed — en reconcile nu ville fx
      // genoplive en session, der er stoppet offline. Køen kører først.
      if (shouldQueueTimerWrites()) return;

      const now = Date.now();
      if (!opts?.immediate && now - lastCheckRef.current < 2000) {
        return;
      }
      lastCheckRef.current = now;

      // Re-entrancy lock: poll ticks, SSE and Electric can all trigger this
      // concurrently, and out-of-order responses would let a STALE snapshot be
      // applied after a newer one. One reconcile at a time; an immediate signal
      // that arrives mid-reconcile queues exactly one follow-up so its change is
      // still picked up right after.
      if (isReconcilingRef.current) {
        if (opts?.immediate) pendingReconcileRef.current = true;
        return;
      }
      isReconcilingRef.current = true;
      const readEpoch = serverConfirmation.beginRead();
      let confirmRead: Omit<
        Parameters<typeof serverConfirmation.complete>[1],
        "local"
      > | null = null;

      try {
        const result = await refetchServerState();
        const serverData = result.data;

        if (!serverData) return;
        // En fejlet refetch beholder forrige data: det er ingen bekræftelse.
        if (result.isSuccess) {
          confirmRead = {
            server: {
              isRunning: serverData.isRunning ?? null,
              intent: serverData.intent ?? null,
              sessionId: serverData.sessionId ?? null,
            },
            serverElapsedSeconds: elapsedFromServer(serverData),
            at: Date.now(),
          };
        }

        // Capture the version we last applied BEFORE overwriting it, so we can
        // tell whether this change came from ANOTHER client (version bumped past
        // what the web itself last wrote/saw). Every write — incl. metadata edits
        // like project/client — bumps the version, so this catches detail changes
        // the run-state-only branches below miss.
        const knownVersion = serverVersionRef.current;
        if (serverData.version !== undefined) {
          serverVersionRef.current = serverData.version;
          useOfflineQueueStore
            .getState()
            .setKnownServerVersion(serverData.version);
        }
        const remoteChange =
          typeof serverData.version === "number" &&
          serverData.version > knownVersion;
        lastFreshReadAtRef.current = Date.now();
        const syncedAtMs = serverData.lastSyncedAt
          ? new Date(serverData.lastSyncedAt).getTime()
          : null;
        if (
          observerRef.current &&
          sawOwnerActivity({
            prevVersion: knownVersion,
            version: serverData.version,
            prevLastSyncedAt: serverLastSyncedAtRef.current,
            lastSyncedAt: syncedAtMs,
          })
        ) {
          ownerSeenAtRef.current = Date.now();
        }
        serverLastSyncedAtRef.current = syncedAtMs;
        lastServerDetailsRef.current = serverData.isRunning
          ? normalizeDetails(serverData)
          : null;

        // ── Timer-sessioner (docs/architecture/timer-sessions.md) ──────────
        const serverSessionId = serverData.sessionId ?? null;
        const localSession = useTimerStore.getState();
        if (
          localSession.sessionId &&
          serverData.intent !== "stopping" &&
          serverSessionId !== localSession.sessionId &&
          (serverData.version ?? 0) >= sessionKnownVersionRef.current
        ) {
          // Vores session er gemt, kasseret eller afløst et andet sted. Den
          // lokale kopi droppes — ALDRIG genoplivet. Grenene nedenfor
          // adopterer serverens kørende/pausede timer, hvis der er en.
          console.log(
            "[Timer Sync] Lokal session afsluttet et andet sted — adopterer serverens tilstand",
          );
          localSession.resetTimer();
          pendingMountReconcileRef.current = false;
          sessionEstablishedRef.current = false;
          adoptOwnSessionDetailsRef.current = false;
          if (prevServerRunningRef.current && !serverData.isRunning) {
            void invalidateDomains(queryClient, TIME_ENTRY_DOMAINS);
          }
        } else if (
          !localSession.sessionId &&
          localSession.isRunning &&
          serverSessionId &&
          serverData.isRunning &&
          serverData.intent !== "stopping" &&
          isOwnLandedStart(serverData.startTime, localSession.startTime)
        ) {
          // Vores egen start er landet (svaret gik tabt): det er vores
          // session. Overtag id'et — og serverens detaljer, medmindre
          // brugeren lige har valgt noget lokalt, der ikke er synket (#786).
          useTimerStore.getState().setSessionId(serverSessionId);
          sessionKnownVersionRef.current = 0;
          sessionEstablishedRef.current = true;
          useTimerStore.getState().setStartOpId(null);
          adoptOwnSessionDetailsRef.current = true;
        }
        if (adoptOwnSessionDetailsRef.current) {
          adoptOwnSessionDetailsRef.current = false;
          const own = useTimerStore.getState();
          if (
            own.isRunning &&
            own.sessionId &&
            own.sessionId === serverSessionId &&
            serverData.isRunning &&
            serverData.intent !== "stopping" &&
            !shouldHoldUnsyncedSelection({
              unsynced: unsyncedSelectionRef.current,
              local: own,
              server: serverData,
            })
          ) {
            applyingServerStateRef.current = true;
            useTimerStore.setState({
              projectId: serverData.projectId || null,
              clientId: serverData.clientId || null,
              taskId: serverData.taskId ?? own.taskId,
              description: serverData.description || "",
            });
            applyingServerStateRef.current = false;
            prevServerRunningRef.current = true;
            prevServerStartRef.current = serverData.startTime
              ? new Date(serverData.startTime).getTime()
              : null;
            return;
          }
        }

        // Første afstemning efter en sideindlæsning med en genindlæst,
        // kørende timer: serveren afgør, aldrig den forældede lokale kopi.
        if (pendingMountReconcileRef.current) {
          pendingMountReconcileRef.current = false;
          const local = useTimerStore.getState();
          if (local.isRunning) {
            const action = decidePersistedRunningOnMount({
              server: {
                isRunning: serverData.isRunning,
                elapsedSeconds: serverData.elapsedSeconds,
                baseSeconds: serverData.baseSeconds,
                intent: serverData.intent,
                lastSyncedAt: serverData.lastSyncedAt,
              },
              localStartTime: local.startTime,
            });
            console.log("[Timer Sync] Genindlæst timer afstemt:", action);
            if (action === "drop-local") {
              // Stoppet (og gemt) et andet sted efter den lokale start.
              local.resetTimer();
              prevServerRunningRef.current = false;
              return;
            }
            if (action === "re-establish") {
              // Den lokale start nåede aldrig serveren — nu må den sendes.
              sessionEstablishedRef.current = false;
              wasRunningRef.current = true;
              prevServerRunningRef.current = false;
              void syncToServerRef.current?.({ isFreshStart: true });
              return;
            }
            if (action === "adopt-server") {
              const serverElapsed = elapsedFromServer(serverData);
              const anchor = Date.now() - serverElapsed * 1000;
              // Samme session (samme projekt/kunde): bevar en lokal binding
              // til en fortsat postering/et segment. Ellers hører sessionen
              // til serverens timer, og bindingen må ikke følge med.
              const sameSelection =
                (serverData.projectId ?? null) === (local.projectId ?? null) &&
                (serverData.clientId ?? null) === (local.clientId ?? null);
              wasRunningRef.current = true;
              isAdoptionRef.current = true;
              sessionEstablishedRef.current = true;
              prevServerRunningRef.current = true;
              applyingServerStateRef.current = true;
              useTimerStore.setState({
                isRunning: true,
                projectId: serverData.projectId || null,
                clientId: serverData.clientId || null,
                description: serverData.description || "",
                taskId: sameSelection
                  ? local.taskId
                  : serverData.taskId || null,
                startTime: anchor,
                sessionStartTime: serverData.startTime
                  ? new Date(serverData.startTime).getTime()
                  : anchor,
                baseTime: 0,
                elapsedTime: serverElapsed,
                sessionId: serverSessionId,
                startOpId: null,
                ...(sameSelection
                  ? {}
                  : {
                      continuingEntryId: null,
                      continuingEntryHours: 0,
                      resumeEntryId: null,
                    }),
              });
              applyingServerStateRef.current = false;
              return;
            }
            // "defer": pauset eller midt i et stop — den almindelige
            // afstemning nedenfor håndterer det.
          }
        }

        // Detect a remote stop: the server timer was running (or mid-stop) and is
        // now fully stopped. That transition means the stop completed on another
        // client (extension/desktop), which typically created a time entry — but
        // the reconcile only syncs timer STATE, so the web's data queries go
        // stale. Refresh them so the new entry / klippekort balance appear
        // without a manual reload. "stopping" counts as still-running so this
        // fires on the FINAL confirmed stop (after the entry has been created),
        // not on the intermediate stopping signal.
        const serverRunningNow =
          !!serverData.isRunning || serverData.intent === "stopping";
        // Stop+gem og ny start inden for samme poll-vindue ses ikke som en
        // kørende→stoppet-overgang, men serverens session-start skifter.
        const serverStartNow =
          serverData.isRunning && serverData.startTime
            ? new Date(serverData.startTime).getTime()
            : null;
        const sessionSwapped =
          remoteChange &&
          prevServerRunningRef.current &&
          serverStartNow !== null &&
          prevServerStartRef.current !== null &&
          serverStartNow !== prevServerStartRef.current;
        prevServerStartRef.current = serverStartNow;
        if (sessionSwapped) {
          void invalidateDomains(queryClient, TIME_ENTRY_DOMAINS);
        }
        if (prevServerRunningRef.current && !serverRunningNow) {
          // Den gemte post kan ændre tidsliste, klippekort- og kundesaldi,
          // projektbudgetter, dashboard-widgets, dækning og ufaktureret tid.
          void invalidateDomains(queryClient, TIME_ENTRY_DOMAINS);

          // A stop+save (e.g. from the extension) clears the server timer
          // entirely; a pause keeps elapsed/base. Only the former should wipe the
          // local widget — otherwise it hangs showing the just-saved session's
          // elapsed time (the stop happened remotely, so nothing else clears it).
          // A pause is handled by the paused-recovery branch further down.
          const serverCleared =
            !serverData.isRunning &&
            !serverData.elapsedSeconds &&
            !serverData.baseSeconds;
          const local = useTimerStore.getState();
          if (serverCleared && (local.isRunning || local.elapsedTime > 0)) {
            local.resetTimer();
            prevServerRunningRef.current = false;
            return;
          }
        }
        prevServerRunningRef.current = serverRunningNow;

        const store = useTimerStore.getState();

        // Mirror a RUNNING timer's details when a remote client changed them
        // (project/client/description, or re-based the time via pause→resume) —
        // even if the web already has a running or paused timer. The transition/
        // adoption branches below only fire on clean start↔stop edges, so without
        // this the web keeps stale details while the extension/desktop (and the
        // Electric badge) already show the new ones. Gated on `remoteChange` so
        // the web never fights its own ticking clock, and only re-anchors time
        // when it actually differs (>2s) to avoid visible micro-jumps.
        if (
          remoteChange &&
          serverData.isRunning &&
          serverData.intent !== "stopping"
        ) {
          if (
            store.isRunning &&
            shouldHoldUnsyncedSelection({
              unsynced: unsyncedSelectionRef.current,
              local: store,
              server: serverData,
            })
          ) {
            // Brugerens kundeskift er ikke nået frem endnu — serverens gamle
            // kunde må ikke overskrive det. Skub den lokale tilstand igen.
            console.log(
              "[Timer Sync] mirror afvist: lokalt projekt/kunde-skift ikke synket endnu",
            );
            void syncToServerRef.current?.();
            return;
          }
          const serverElapsed = elapsedFromServer(serverData);
          const differs =
            !store.isRunning ||
            (serverData.projectId ?? null) !== (store.projectId ?? null) ||
            (serverData.clientId ?? null) !== (store.clientId ?? null) ||
            (serverData.description ?? "") !== (store.description ?? "") ||
            Math.abs(serverElapsed - store.elapsedTime) > 2;
          // Et TILBAGESPRING (serverens elapsed er lavere end vores) må kun
          // accepteres når rækken sidst blev skrevet af en ANDEN kilde. Er den
          // sidst skrevet af web, er det vores egen forsinkede skrivning der
          // trækker displayet baglæns — det er "timeren starter forfra" (#589).
          const acceptReanchor = shouldAcceptMirrorReanchor({
            localElapsed: store.elapsedTime,
            serverElapsed,
            lastSyncedFrom: serverData.lastSyncedFrom ?? null,
          });
          if (differs && !acceptReanchor) {
            console.log("[Timer Sync] mirror re-anchor afvist (eget spring)", {
              local: store.elapsedTime,
              server: serverElapsed,
              version: serverData.version,
              lastSyncedFrom: serverData.lastSyncedFrom ?? null,
            });
          }
          if (differs && acceptReanchor && serverElapsed <= 43200) {
            console.log("[Timer Sync] mirror re-anchor", {
              local: store.elapsedTime,
              server: serverElapsed,
              version: serverData.version,
              lastSyncedFrom: serverData.lastSyncedFrom ?? null,
            });
            // Adopt the server's running state as the source of truth. isAdoption
            // lets the next heartbeat take ownership without tripping the
            // one-running-timer guard (same mechanism as the adoption branch).
            wasRunningRef.current = true;
            isAdoptionRef.current = true;
            sessionEstablishedRef.current = true;
            const anchor = Date.now() - serverElapsed * 1000;
            applyingServerStateRef.current = true;
            useTimerStore.setState({
              isRunning: true,
              projectId: serverData.projectId || null,
              clientId: serverData.clientId || null,
              description: serverData.description || "",
              startTime: anchor,
              sessionStartTime: serverData.startTime
                ? typeof serverData.startTime === "string"
                  ? new Date(serverData.startTime).getTime()
                  : serverData.startTime
                : anchor,
              baseTime: 0,
              elapsedTime: serverElapsed,
              sessionId: serverSessionId,
              startOpId: null,
              // Sessionen tilhører nu serverens timer — en lokal binding til en
              // tidligere postering må ikke følge med, ellers gemmes den nye
              // kundes tid oven i den gamle postering (kunde A 28/8).
              continuingEntryId: null,
              continuingEntryHours: 0,
              resumeEntryId: null,
            });
            applyingServerStateRef.current = false;
            return;
          }
        }

        // If timer is being stopped, don't recover
        if (serverData.intent === "stopping") {
          // If local timer is running but server has stopping intent, stop local.
          // Venter fanen selv på svar på et stop-claim, er rækken sandsynligvis
          // vores eget claim: stopvejen afgør sessionen, ikke afstemningen
          // (#1333). Ellers rydder den stopmålets start, og svaret afvises.
          if (store.isRunning && !isStopClaimInFlight()) {
            console.log(
              "[Timer Sync] Server timer is stopping (from",
              serverData.intentFrom,
              "), stopping local timer",
            );
            useTimerStore.setState({
              isRunning: false,
              startTime: null,
              sessionStartTime: null,
              elapsedTime: store.elapsedTime,
              baseTime: store.elapsedTime,
            });
          }
          return;
        }

        // CRITICAL: If server timer is stopped but local is running, stop local timer
        // This handles when extension stops the timer
        if (!serverData.isRunning && store.isRunning) {
          // A fully CLEARED server row means the stop completed elsewhere and the
          // session was SAVED there. Parking the local elapsed as "paused" would
          // hand the user a resumable copy of already-saved time — the next
          // "Start" silently continues it, and the old session rides into the
          // next entry (the classic "gammel tid lægges ovenpå ny registrering").
          const serverFullyCleared =
            !serverData.elapsedSeconds &&
            !serverData.baseSeconds &&
            !serverData.intent;
          // Grace: a locally started timer may race its own establishing sync
          // (the fetched server row can predate the start, or the sync POST
          // failed transiently while polls succeed). Never wipe those young —
          // 45s covers the first heartbeat retry at 30s.
          const localSessionAgeMs = store.startTime
            ? Date.now() - store.startTime
            : Number.POSITIVE_INFINITY;
          if (serverFullyCleared && localSessionAgeMs < 45_000) {
            return;
          }
          if (serverFullyCleared && !sessionEstablishedRef.current) {
            // Vores egen start er aldrig nået frem (tabt/fejlet sync) — den
            // tomme række er IKKE et stop fra en anden enhed. Etablér igen i
            // stedet for at smide brugerens tid væk.
            console.warn(
              "[Timer Sync] Session not established, retrying start",
            );
            void syncToServerRef.current?.({ isFreshStart: true });
            return;
          }
          if (serverFullyCleared) {
            console.log(
              "[Timer Sync] Server timer stopped+cleared elsewhere, resetting local timer",
            );
            store.resetTimer();
            return;
          }
          console.log(
            "[Timer Sync] Server timer paused (likely from extension), pausing local timer",
          );
          useTimerStore.setState({
            isRunning: false,
            startTime: null,
            // A remote PAUSE is unsaved work — keep sessionStartTime so the
            // session stays resumable (sessionStartTime === null is reserved
            // for parked copies of stops that completed elsewhere).
            sessionStartTime: store.sessionStartTime,
            // Keep elapsed time for potential save
            elapsedTime: store.elapsedTime,
            baseTime: store.elapsedTime,
          });
          return; // Don't proceed with recovery logic
        }

        // Stale parked leftover: an earlier reconcile parked a remotely-stopped
        // session as "paused" (sessionStartTime === null is the marker — a real
        // user pause keeps it). If the server row is fully cleared, that time was
        // already saved elsewhere; drop the leftover so it can't be resumed into
        // a new entry.
        if (
          !serverData.isRunning &&
          !serverData.intent &&
          !serverData.elapsedSeconds &&
          !serverData.baseSeconds &&
          !store.isRunning &&
          store.elapsedTime > 0 &&
          store.sessionStartTime === null
        ) {
          console.log(
            "[Timer Sync] Clearing stale parked timer leftover (session already saved elsewhere)",
          );
          store.resetTimer();
          return;
        }

        // If server has a running timer but local doesn't, adopt it. The server
        // is authoritative in the one-running-timer model, so a running server
        // timer must win even when the local store still holds stale elapsed from
        // a paused session — otherwise resuming from the extension/another device
        // leaves the web widget frozen on the old paused state while the server
        // (and Electric) already show it running.
        if (serverData.isRunning && !store.isRunning) {
          {
            console.log(
              "[Timer Sync] Recovering timer from server:",
              serverData,
            );

            // Calculate elapsed time from server state
            let elapsed = serverData.elapsedSeconds || 0;
            if (serverData.startTime) {
              const serverStartTime =
                typeof serverData.startTime === "string"
                  ? new Date(serverData.startTime).getTime()
                  : serverData.startTime;
              const now = Date.now();
              const sessionSeconds = Math.floor((now - serverStartTime) / 1000);
              // Safety: cap session time at 24 hours to prevent corruption
              const safeSessionSeconds = Math.max(
                0,
                Math.min(sessionSeconds, 86400),
              );
              elapsed = (serverData.baseSeconds || 0) + safeSessionSeconds;
            }

            // Safety: cap total elapsed at 24 hours
            elapsed = Math.max(0, Math.min(elapsed, 86400));

            // If elapsed time is unreasonably high (> 12 hours), don't auto-recover
            // This prevents restoring corrupted timer state
            if (elapsed > 43200) {
              console.warn(
                "[Timer Sync] Skipping recovery - elapsed time too high:",
                elapsed,
              );
              return;
            }

            // Adopting the server's running timer — not a fresh start. Mark it
            // as already-running so the start effect's immediate sync doesn't
            // send isFreshStart and get itself rejected. The adoption flag lets
            // that first sync take ownership (the running timer may still be
            // owned by the extension) without tripping the server's
            // one-running-timer guard.
            wasRunningRef.current = true;
            isAdoptionRef.current = true;
            sessionEstablishedRef.current = true;

            // Start timer with server state
            store.startTimer({
              clientId: serverData.clientId || null,
              projectId: serverData.projectId || null,
              description: serverData.description || "",
              // taskId not available from server
            });
            // Serverens session er nu vores (timer-sessioner)
            useTimerStore.getState().setSessionId(serverSessionId);
            sessionKnownVersionRef.current = 0;

            // Update elapsed time to match server
            if (elapsed > 0) {
              // We need to set the startTime to account for elapsed time
              const adjustedStartTime = Date.now() - elapsed * 1000;
              useTimerStore.setState({
                startTime: adjustedStartTime,
                sessionStartTime: serverData.startTime
                  ? typeof serverData.startTime === "string"
                    ? new Date(serverData.startTime).getTime()
                    : serverData.startTime
                  : adjustedStartTime,
                baseTime: 0,
                elapsedTime: elapsed,
              });
            }
          }
        }

        // If server timer is not running but has elapsed time, and local has nothing
        // This handles paused timers from extension
        if (
          !serverData.isRunning &&
          (serverData.elapsedSeconds > 0 || serverData.baseSeconds > 0)
        ) {
          // Adopt when local is empty — or when local only holds a PARKED
          // leftover (sessionStartTime === null): the server's paused seconds
          // are unsaved work and must win over the parked copy.
          if (
            !store.isRunning &&
            (store.elapsedTime === 0 || store.sessionStartTime === null)
          ) {
            const elapsed =
              serverData.elapsedSeconds || serverData.baseSeconds || 0;
            const baseTime =
              serverData.baseSeconds || serverData.elapsedSeconds || 0;

            // Safety: cap at 24 hours and skip if unreasonably high
            const safeElapsed = Math.max(0, Math.min(elapsed, 86400));
            const safeBaseTime = Math.max(0, Math.min(baseTime, 86400));

            if (safeElapsed > 43200) {
              console.warn(
                "[Timer Sync] Skipping paused recovery - elapsed time too high:",
                elapsed,
              );
              return;
            }

            console.log(
              "[Timer Sync] Recovering paused timer from server:",
              serverData,
            );

            useTimerStore.setState({
              isRunning: false,
              projectId: serverData.projectId || null,
              clientId: serverData.clientId || null,
              description: serverData.description || "",
              elapsedTime: safeElapsed,
              baseTime: safeBaseTime,
              startTime: null,
              // Server-side paused seconds are unsaved — derive a session start
              // so the pause is resumable (a genuine pause, not a parked copy).
              sessionStartTime: Date.now() - safeElapsed * 1000,
              sessionId: serverSessionId,
              startOpId: null,
              // Samme binding-regel som i adoptionen ovenfor.
              continuingEntryId: null,
              continuingEntryHours: 0,
              resumeEntryId: null,
            });
          }
        }
      } catch (error) {
        confirmRead = null;
        console.error("[Timer Sync] Failed to check server state:", error);
      } finally {
        isReconcilingRef.current = false;
        // Serverens tilstand er nu anvendt på fanen (alle grene ovenfor).
        if (confirmRead) {
          serverConfirmation.complete(readEpoch, {
            ...confirmRead,
            local: useTimerStore.getState(),
          });
        }
        // A realtime signal arrived mid-reconcile — run one follow-up so its
        // change isn't lost to the lock.
        if (pendingReconcileRef.current) {
          pendingReconcileRef.current = false;
          lastCheckRef.current = 0;
          setTimeout(() => {
            void checkAndRecoverFromServerRef.current?.();
          }, 0);
        }
      }
    },
    [refetchServerState, queryClient, serverConfirmation],
  );

  // Realtime signals reconcile IMMEDIATELY (bypass the 2s poll throttle) so
  // cross-instance state converges without the poll-cadence lag.
  const reconcileImmediate = useCallback(() => {
    void checkAndRecoverFromServer({ immediate: true });
  }, [checkAndRecoverFromServer]);

  // Realtime push: when enabled, an SSE "timer" event triggers an immediate
  // server reconcile instead of waiting for the next poll. Reuses the existing,
  // well-tested reconciliation; falls back to polling silently when disabled.
  // "data"-events over SSE: tidsposter/klippekort/fakturaer ændret på en
  // anden enhed (extension, mobil, desktop, API) eller fane. Fanens eget ekko
  // springes over (MutationCache har allerede invalideret), og resten samles
  // med krydsfane-beskeder, så samme ændring kun hentes én gang.
  const onRemoteDataChanged = useCallback(
    (msg: DataChangeMessage) => {
      if (msg.origin && msg.origin === getTabId()) return;
      remoteInvalidatorFor(queryClient).push(msg.domains);
    },
    [queryClient],
  );

  const { connected: sseConnected } = useTimerRealtime(
    reconcileImmediate,
    onRemoteDataChanged,
  );

  // ElectricSQL (beta spike #260): a change to the user's timer row streamed
  // via Electric triggers the SAME reconcile as SSE — but immediate, so the
  // web widget converges with the extension/desktop near-instantly. Additive on
  // top of SSE + polling; no-ops (proxy 503/404) on prod.
  useTimerElectricSync(reconcileImmediate);

  // Keep the forward ref in sync so syncToServer can trigger a reconcile.
  checkAndRecoverFromServerRef.current = checkAndRecoverFromServer;

  // Ejerskab lige overtaget (fx den forrige ejer-fane blev lukket): tag over
  // uden hul. En kørende timer er allerede adopteret til visning af alle
  // faner (reconcile-læsninger er aldrig gated), men denne fane har aldrig
  // selv skrevet den — markér som adoption og send med det samme, i stedet
  // for at vente på næste 30s-tik.
  useEffect(() => {
    if (
      !isOwner ||
      !shouldTakeOverOnHandover({
        handover: ownershipHandover,
        isRunning: useTimerStore.getState().isRunning,
        pendingMountReconcile: pendingMountReconcileRef.current,
      })
    ) {
      return;
    }
    isAdoptionRef.current = true;
    void syncToServerRef.current?.();
  }, [isOwner, ownershipHandover]);

  // Offline-køen er tømt: en afspillet start har etableret sessionen, og
  // serveren er igen sandheden — reconcile og skub den lokale tilstand.
  useEffect(() => {
    const onDrained = async () => {
      const state = useTimerStore.getState();
      const established =
        state.sessionStartTime !== null &&
        useOfflineQueueStore.getState().establishedSessionStart ===
          state.sessionStartTime;
      if (established && state.isRunning) {
        sessionEstablishedRef.current = true;
        wasRunningRef.current = true;
      }
      // Skub den lokale tilstand FØR reconcile: en pause lavet mens køen
      // ventede, ville ellers blive overskrevet af serverens kørende række
      // (som den afspillede start netop har skabt).
      if (established && (state.isRunning || state.elapsedTime > 0)) {
        await syncToServerRef.current?.();
      }
      lastCheckRef.current = 0;
      await checkAndRecoverFromServerRef.current?.();
    };
    const listener = () => void onDrained();
    window.addEventListener(OFFLINE_QUEUE_DRAINED_EVENT, listener);
    return () =>
      window.removeEventListener(OFFLINE_QUEUE_DRAINED_EVENT, listener);
  }, []);

  // Check for server state on initial mount
  useEffect(() => {
    if (!hasCheckedRecoveryRef.current) {
      hasCheckedRecoveryRef.current = true;
      // Small delay to let the component mount properly
      const timeout = setTimeout(() => {
        checkAndRecoverFromServer();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [checkAndRecoverFromServer]);

  // Poll for external changes - ALWAYS poll to detect changes from extension
  // When timer is not running: poll frequently to pick up starts from extension
  // When timer is running: poll less frequently to detect stops from extension
  useEffect(() => {
    // When SSE is live it pushes changes instantly, so polling drops to a slow
    // safety-net interval; without SSE it keeps the original fast cadence.
    const pollInterval = sseConnected
      ? 60000
      : isRunning
        ? RUNNING_POLL_INTERVAL_MS
        : POLL_INTERVAL_MS;

    // Always poll to detect external changes (starts/stops from extension)
    pollIntervalRef.current = setInterval(() => {
      // Backoff efter gentagne fejl — springer tikket over, giver aldrig op.
      if (Date.now() < pollBackoffUntilRef.current) {
        return;
      }
      checkAndRecoverFromServer();
    }, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isRunning, sseConnected, checkAndRecoverFromServer]);

  // Nettet er tilbage eller fanen er synlig igen: drop backoff og afstem med
  // det samme i stedet for at vente på næste tik.
  // Fokus og bfcache gør det samme: fanens timer kan være forældet, så
  // bekræftelsen glemmes, til afstemningen har svaret igen (#1324).
  useEffect(() => {
    const resume = () => {
      serverConfirmation.invalidate();
      if (document.visibilityState === "hidden") return;
      pollBackoffUntilRef.current = 0;
      void checkAndRecoverFromServerRef.current?.({ immediate: true });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resume();
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [serverConfirmation]);

  // Set up periodic sync when timer is running
  useEffect(() => {
    // Første kørsel: en timer der allerede kører nu, er genindlæst fra
    // localStorage — ikke startet af brugeren. Den afstemmes med serveren
    // (checkAndRecoverFromServer) før noget sendes.
    if (!mountCheckedRef.current) {
      mountCheckedRef.current = true;
      if (isRunning) pendingMountReconcileRef.current = true;
    }
    if (isRunning) {
      if (pendingMountReconcileRef.current) {
        wasRunningRef.current = true;
      } else {
        // Sync immediately when timer starts. If the timer wasn't running
        // before this transition, it's a fresh user-initiated start — flag
        // it so the server can block it when another client is already
        // running a timer. (Recovery/adoption pre-sets wasRunningRef, so
        // adopted timers don't count as fresh starts — that case is the
        // automatic adoption takeover, gated on tab ownership below.)
        const isFreshStart = !wasRunningRef.current;
        if (isFreshStart) sessionEstablishedRef.current = false;
        syncToServer(
          isFreshStart ? { isFreshStart: true } : { background: true },
        );
        wasRunningRef.current = true;
      }

      // Set up interval for periodic sync (heartbeat) — a baggrunds-
      // skrivning, gated på tab-ejerskab inde i syncToServer.
      syncIntervalRef.current = setInterval(() => {
        syncToServer({ background: true });
      }, SYNC_INTERVAL_MS);
    } else {
      // Clear interval when timer stops
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }

      // Note: We no longer auto-clear here since the intent system handles it
      wasRunningRef.current = false;
      adoptOwnSessionDetailsRef.current = false;
      unsyncedSelectionRef.current = null;
      sessionEstablishedRef.current = false;
      observerRef.current = false;
      // A stale adoption flag must not leak into a later fresh start — that
      // would let it bypass the server's one-running-timer guard.
      isAdoptionRef.current = false;
    }

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [isRunning, syncToServer]);

  // Projekt/kunde skiftet på en KØRENDE timer (TimeTrackingBar, TimerWidget,
  // genvejstaster …) synkes med det samme — ikke først ved næste 30 s-
  // heartbeat. Ellers viser extensionen den gamle kunde, og en afstemning i
  // mellemtiden kunne rulle skiftet tilbage ("timeren skifter pludselig
  // kunde", kunde A 1/10). Ét abonnement dækker alle kaldesteder.
  useEffect(
    () =>
      useTimerStore.subscribe((state, prev) => {
        if (!state.isRunning || !prev.isRunning) return;
        if (applyingServerStateRef.current) return;
        // Tid lagt til/trukket fra lokalt (fx "+15 min") er en lokal ændring:
        // en observatør skal sende den med næste sync, ikke springe den over.
        if (state.baseTime !== prev.baseTime) observerRef.current = false;
        const changed =
          (state.projectId || null) !== (prev.projectId || null) ||
          (state.clientId || null) !== (prev.clientId || null);
        if (!changed) return;
        unsyncedSelectionRef.current = {
          projectId: state.projectId || null,
          clientId: state.clientId || null,
        };
        void syncToServerRef.current?.();
      }),
    [],
  );

  // Sync before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = useTimerStore.getState();
      if (state.isRunning) {
        // Note: This relies on the recovery mechanism on next page load.
        // sendBeacon could be used here with a dedicated endpoint.
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return {
    syncToServer,
    clearServerState,
    checkAndRecoverFromServer,
    claimTimerForStop,
    confirmStop,
    cancelStop,
    cancelStopOnUnload,
    syncOnUnload,
    lastSyncedAt: lastSyncRef.current,
    isSyncing: syncMutation.isPending,
    serverVersion: serverVersionRef.current,
    serverConfirmation,
  };
}
