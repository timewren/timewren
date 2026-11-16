import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type CreateEntryInput,
  enqueueOp,
  isNetworkError,
  pendingCount,
  type QueueItem,
  type QueueOp,
  resetForRetry,
  type TimerStartPayload,
} from "@/lib/offline/queue";

/**
 * Persistent offline-kø (#703). Samme persist-mønster som timerStore —
 * localStorage, så køen overlever reload og lukket fane. Logikken bor i
 * `@/lib/offline/queue` (ren og testet); her er kun tilstand.
 */
interface OfflineQueueState {
  items: QueueItem[];
  /** Bruger der skrev køen — en anden konto i samme browser arver den ikke. */
  ownerUserId: string | null;
  /** Timer-rækkens version, som web sidst så den (bruges af offline-stop). */
  knownServerVersion: number | null;
  /**
   * Sessionsstart (sessionStartTime) for den session, serveren senest har
   * bekræftet. En session serveren kender, får aldrig en køet start — og et
   * offline-stop af den skal claime serverens række.
   */
  establishedSessionStart: number | null;
  /**
   * Den aktive org, sidst sessionen blev set. Nye elementer stemples med den,
   * så de afspilles i samme org efter et orgskift. Persisteret, så en
   * koldstart uden net stadig kender den.
   */
  currentOrgId: string | null;
  /** Runtime: browserens online-tilstand. */
  isOnline: boolean;
  /** Runtime: dræning i gang. */
  isSyncing: boolean;
  /** Runtime: elementet der netop sendes (må ikke komprimeres væk). */
  inFlightOpId: string | null;
  /** Runtime: sidste vellykkede dræning (epoch-ms). */
  lastSyncedAt: number | null;

  enqueue: (op: QueueOp) => void;
  setItems: (items: QueueItem[]) => void;
  retryAll: () => void;
  discardFailed: () => void;
  adoptOwner: (userId: string) => void;
  setCurrentOrg: (orgId: string | null) => void;
  setKnownServerVersion: (version: number) => void;
  setEstablishedSession: (sessionStart: number | null) => void;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setInFlight: (opId: string | null) => void;
  markSynced: () => void;
}

export const OFFLINE_QUEUE_STORAGE_KEY = "timetrack-offline-queue";

function initialOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export const useOfflineQueueStore = create<OfflineQueueState>()(
  persist(
    (set, get) => ({
      items: [],
      ownerUserId: null,
      knownServerVersion: null,
      establishedSessionStart: null,
      currentOrgId: null,
      isOnline: initialOnline(),
      isSyncing: false,
      inFlightOpId: null,
      lastSyncedAt: null,

      enqueue: (op) =>
        set({
          items: enqueueOp(
            get().items,
            op,
            Date.now(),
            get().inFlightOpId,
            get().currentOrgId,
          ),
        }),
      setItems: (items) => set({ items }),
      retryAll: () =>
        set({
          items: get().items.map((i) => (i.failed ? resetForRetry(i) : i)),
        }),
      discardFailed: () => set({ items: get().items.filter((i) => !i.failed) }),
      // En anden KENDT ejer tømmer køen; første login overtager den.
      adoptOwner: (userId) =>
        set((s) =>
          s.ownerUserId && s.ownerUserId !== userId
            ? { ownerUserId: userId, items: [], establishedSessionStart: null }
            : { ownerUserId: userId },
        ),
      setCurrentOrg: (currentOrgId) => set({ currentOrgId }),
      setKnownServerVersion: (knownServerVersion) =>
        set({ knownServerVersion }),
      setEstablishedSession: (establishedSessionStart) =>
        set({ establishedSessionStart }),
      setOnline: (isOnline) => set({ isOnline }),
      setSyncing: (isSyncing) => set({ isSyncing }),
      setInFlight: (inFlightOpId) => set({ inFlightOpId }),
      markSynced: () => set({ lastSyncedAt: Date.now() }),
    }),
    {
      name: OFFLINE_QUEUE_STORAGE_KEY,
      partialize: (s) => ({
        items: s.items,
        ownerUserId: s.ownerUserId,
        knownServerVersion: s.knownServerVersion,
        establishedSessionStart: s.establishedSessionStart,
        currentOrgId: s.currentOrgId,
      }),
    },
  ),
);

/** Ny idempotensnøgle pr. operation. */
export function newOpId(): string {
  return crypto.randomUUID();
}

/**
 * Skal timer-ændringer gå gennem køen lige nu? Ja når browseren er offline —
 * og når køen stadig har ventende elementer: så må intet overhale dem
 * (et stop online før en køet start ville ramme en række, serveren ikke har).
 */
export function shouldQueueTimerWrites(): boolean {
  const s = useOfflineQueueStore.getState();
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  return offline || pendingCount(s.items) > 0;
}

/**
 * Timerstart, som serveren endnu ikke har set (startet uden net, eller den
 * etablerende sync døde). Lægges i køen én gang pr. session.
 */
export function enqueueOfflineStart(
  payload: TimerStartPayload,
  /**
   * Startens idempotensnøgle, hvis den allerede er sendt online (tabt svar):
   * samme nøgle i køen gør online-forsøget og afspilningen til én start.
   */
  opId?: string,
): void {
  const s = useOfflineQueueStore.getState();
  if (s.establishedSessionStart === payload.sessionStartTime) return;
  s.enqueue({ kind: "timer.start", opId: opId ?? newOpId(), payload });
}

/**
 * Timerstop uden net: posten gemmes, når nettet er tilbage. Kender serveren
 * sessionen, claimes dens række først (samme koreografi som online); ellers
 * gemmes kun posten, og serverens timer røres ikke.
 */
export function enqueueOfflineStop(args: {
  sessionStartTime: number | null;
  startTime: number | null;
  entry: CreateEntryInput;
}): void {
  const s = useOfflineQueueStore.getState();
  s.enqueue({
    kind: "timer.stop",
    opId: newOpId(),
    sessionStartTime: args.sessionStartTime,
    serverStartTime: args.startTime,
    knownVersion: s.knownServerVersion,
    serverKnown:
      args.sessionStartTime !== null &&
      s.establishedSessionStart === args.sessionStartTime,
    entry: args.entry,
  });
}

export type CreateOrQueueResult<T> =
  | { kind: "sent"; result: T }
  | { kind: "queued"; hours: number };

/**
 * Opret en tidspost — eller læg den i offline-køen, hvis nettet er væk.
 *
 * Nøglen genereres FØR første forsøg og følger posten ind i køen: dør kaldet
 * med tabt forbindelse efter at serveren har gemt posten, genkender serveren
 * afspilningen på `clientEntryId` og returnerer den eksisterende post.
 * Kun tabt forbindelse køes — en afvisning fra serveren kastes videre.
 */
export async function createOrQueue<T>(
  entry: CreateEntryInput,
  run: (entry: CreateEntryInput) => Promise<T>,
): Promise<CreateOrQueueResult<T>> {
  const opId = newOpId();
  const keyed: CreateEntryInput = { ...entry, clientEntryId: opId };
  const queue = (): CreateOrQueueResult<T> => {
    useOfflineQueueStore
      .getState()
      .enqueue({ kind: "time.create", opId, entry: keyed });
    return { kind: "queued", hours: entry.hours };
  };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return queue();
  }
  try {
    return { kind: "sent", result: await run(keyed) };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return queue();
  }
}
