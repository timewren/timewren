import type { CreateMeta, QueuedMutation, QueueItem } from './queue-logic';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CLIENT_VERSION } from '~/lib/api/client-version';
import { storage } from '~/lib/storage';
import { createSelectors } from '~/lib/utils';
import { adoptUnstamped, afterFailure, enqueueItem, orgToStamp, resetForRetry, resumeAfterLogin, resumeAfterUpdate } from './queue-logic';

export const OFFLINE_QUEUE_STORAGE_KEY = 'offline-queue';

type QueueState = {
  items: QueueItem[];
  /** Er enheden online ifølge sidste netværks-event (spejl af onlineManager). */
  isOnline: boolean;
  /** Dræning i gang */
  isSyncing: boolean;
  /**
   * Aktiv organisations id, som stemplede nye elementer med. `undefined` betyder
   * "endnu ikke kendt" (capabilities ikke hentet) — da stempleres intet, så
   * elementet stadig kan drænes i stedet for at blive strandet i køen. `null`
   * (solo) stempler også intet, se `orgToStamp`.
   */
  activeOrgId: string | null | undefined;
  /**
   * Bruger-id, køen er skrevet af. Bevares, når sessionen forsvinder under os,
   * så den samme bruger får sine usendte poster tilbage — og kun så en ANDEN
   * konto på enheden ikke arver dem (`adoptOwner` tømmer ved skift).
   */
  ownerUserId: string | undefined;
};

type QueueActions = {
  enqueue: (mutation: QueuedMutation, now?: Date) => QueueItem | null;
  remove: (id: string) => void;
  markFailure: (id: string, error: unknown, now?: number) => void;
  retry: (id: string) => void;
  retryAll: () => void;
  /** Erstat et element i farten (fx markér en create ubekræftet før afsendelse). */
  replace: (item: QueueItem) => void;
  /** Omskriv køen (fx klip poster efter en timerkonflikt, se `drain.ts`). */
  patchItems: (fn: (items: QueueItem[]) => QueueItem[]) => void;
  /** Tøm hele køen (bruges ved logout så en anden bruger ikke arver ventende poster). */
  clearAll: () => void;
  /** Log ind som `userId`: en anden kendt ejer tømmer køen, ellers overtages den. */
  adoptOwner: (userId: string) => void;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setActiveOrgId: (orgId: string | null | undefined) => void;
};

export type OfflineQueueStore = QueueState & QueueActions;

const mmkvStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.set(name, value),
  removeItem: (name: string) => storage.remove(name),
};

function newId(): string {
  return Crypto.randomUUID();
}

/**
 * Idempotensnøgle på hver kø-oprettelse — én nøgle pr. element, som følger
 * alle genforsøg. Uden den kan opslaget efter et tabt svar ikke kende vores
 * post fra en ægte, brugeren lavede selv samme dag (se `create-dedup.ts`).
 *
 * Nøglen ligger i `meta`, ikke i payload: `dedupKey` skal fortsat kunne finde
 * to identiske mutationer, så en dobbelttrykket "1 t Support" ikke fylder køen
 * med to nøgler der ikke ligner hinanden.
 */
function withCreateKey(mutation: QueuedMutation): { meta?: CreateMeta } {
  if (mutation.type !== 'time.create')
    return {};
  if (mutation.meta?.clientEntryId)
    return { meta: mutation.meta };
  return { meta: { ...mutation.meta, clientEntryId: newId() } };
}

/**
 * Køet timerstart: nøglen sendes i payload, så serveren kan gemme den på
 * timer-rækken og genkende en afspilning — samme nøgle = én effekt (#703).
 */
function withStartKey(mutation: QueuedMutation): QueuedMutation {
  if (mutation.type !== 'timer.start' || mutation.payload.clientOpId)
    return mutation;
  return { ...mutation, payload: { ...mutation.payload, clientOpId: newId() } };
}

const _useOfflineQueue = create<OfflineQueueStore>()(
  persist(
    (set, get) => ({
      items: [],
      isOnline: true,
      isSyncing: false,
      activeOrgId: undefined,
      ownerUserId: undefined,
      enqueue: (input, now = new Date()) => {
        const mutation = withStartKey(input);
        const { activeOrgId } = get();
        const orgId = orgToStamp(activeOrgId);
        const item: QueueItem = {
          ...mutation,
          id: newId(),
          createdAt: now.toISOString(),
          attempts: 0,
          lastError: null,
          failed: false,
          nextAttemptAt: 0,
          ...withCreateKey(mutation),
          ...(orgId ? { orgId } : {}),
        };
        const result = enqueueItem(get().items, item, { draining: get().isSyncing });
        if (!result.added)
          return null;
        set({ items: result.items });
        return item;
      },
      remove: id => set(s => ({ items: s.items.filter(i => i.id !== id) })),
      clearAll: () => set({ items: [] }),
      // Køen overlever en session, der forsvinder under os (udløbet cookie),
      // så en udløbet session må ikke slette time, brugeren ikke fik sendt.
      // Den må bare heller ikke give den næste konto på enheden videre: en
      // anden KENDT ejer tømmer den. `undefined` (aldrig logget ind siden
      // opdateringen) overtages uden tømning, så ældre køer ikke taber tid.
      // Samme ejer: alt, der kun ventede på et nyt login — eller på en ny
      // appversion efter CLIENT_TOO_OLD — vækkes. Først HER, efter ejer-tjekket,
      // så en anden kontos session aldrig dræner dem.
      adoptOwner: userId =>
        set(s => (s.ownerUserId && s.ownerUserId !== userId
          ? { ownerUserId: userId, items: [] }
          : { ownerUserId: userId, items: resumeAfterUpdate(resumeAfterLogin(s.items), CLIENT_VERSION) })),
      markFailure: (id, error, now = Date.now()) =>
        set(s => ({ items: s.items.map(i => (i.id === id ? afterFailure(i, error, now) : i)) })),
      retry: id => set(s => ({ items: s.items.map(i => (i.id === id ? resetForRetry(i) : i)) })),
      retryAll: () => set(s => ({ items: s.items.map(i => (i.failed ? resetForRetry(i) : i)) })),
      replace: item => set(s => ({ items: s.items.map(i => (i.id === item.id ? item : i)) })),
      patchItems: fn => set(s => ({ items: fn(s.items) })),
      setOnline: isOnline => set({ isOnline }),
      setSyncing: isSyncing => set({ isSyncing }),
      // Når den aktive org bliver kendt, overtager den elementer, der fik
      // `orgId: null` mens capabilities ikke kunne hentes (kolde start
      // uden net). Uden denne stod de i køen for evigt — `inActiveOrg`
      // kan hverken holde eller dræne dem, og tiden blev aldrig gemt.
      setActiveOrgId: activeOrgId =>
        set(s => ({ activeOrgId, items: adoptUnstamped(s.items, activeOrgId) })),
    }),
    {
      name: OFFLINE_QUEUE_STORAGE_KEY,
      storage: createJSONStorage(() => mmkvStorage),
      // Køen og dens ejer persisteres — online/sync/org er runtime-tilstand.
      partialize: state =>
        ({ items: state.items, ownerUserId: state.ownerUserId }) as OfflineQueueStore,
    },
  ),
);

export const useOfflineQueue = createSelectors(_useOfflineQueue);

export const offlineQueue = () => _useOfflineQueue.getState();
export const subscribeOfflineQueue = _useOfflineQueue.subscribe;
