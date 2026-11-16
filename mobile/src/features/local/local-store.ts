import type { LocalData, LocalEntry, LocalSelection, RemoteIdMap } from './local-logic';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage } from '~/lib/storage';
import { createSelectors } from '~/lib/utils';
import { EMPTY_LOCAL_DATA, EMPTY_SELECTION, removeClient, removeProject, removeTag, stopTimer, TAG_COLORS } from './local-logic';

export const LOCAL_STORAGE_KEY = 'local-mode';

type LocalState = LocalData & {
  /** Brugeren har valgt at bruge appen uden konto. */
  enabled: boolean;
  /** Valg til næste timer-start (husker sidste projekt/kunde/tags). */
  draft: LocalSelection;
  /** Server-id'er fra en påbegyndt overførsel, så et afbrudt forløb kan genoptages uden dubletter. */
  remoteIds: RemoteIdMap;
  /** Brugeren har lukket "Kun på denne telefon"-banneret (tilbydes stadig under Administrér). */
  bannerDismissed: boolean;
  /** "Senere" på overførsels-skærmen — gælder kun denne app-session (persisteres ikke). */
  importDeferred: boolean;
};

type LocalActions = {
  enable: () => void;
  setDraft: (draft: LocalSelection) => void;
  startTimer: (now?: Date) => void;
  /** Stop og gem. Returnerer posten, eller null hvis den var under ét minut. */
  stopTimer: (now?: Date) => LocalEntry | null;
  discardTimer: () => void;
  updateTimer: (patch: Partial<LocalSelection>) => void;
  addEntry: (e: Omit<LocalEntry, 'id' | 'createdAt'>) => void;
  updateEntry: (id: string, patch: Partial<Omit<LocalEntry, 'id'>>) => void;
  deleteEntry: (id: string) => void;
  addClient: (name: string) => string;
  addProject: (name: string, clientId: string | null) => string;
  addTag: (name: string) => string;
  deleteClient: (id: string) => void;
  deleteProject: (id: string) => void;
  deleteTag: (id: string) => void;
  setRemoteId: (localId: string, remoteId: string) => void;
  deferImport: () => void;
  dismissBanner: () => void;
  /** Efter overførsel til konto (eller hvis brugeren sletter alt): ryd og slå tilstanden fra. */
  clearAll: () => void;
};

export type LocalStore = LocalState & LocalActions;

const mmkvStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.set(name, value),
  removeItem: (name: string) => storage.remove(name),
};

const newId = () => Crypto.randomUUID();
const nowIso = () => new Date().toISOString();

const INITIAL: LocalState = { ...EMPTY_LOCAL_DATA, enabled: false, draft: EMPTY_SELECTION, remoteIds: {}, importDeferred: false, bannerDismissed: false };

const _useLocalStore = create<LocalStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,
      enable: () => set({ enabled: true }),
      setDraft: draft => set({ draft }),
      startTimer: (now = new Date()) => {
        if (get().timer)
          return;
        // Beskrivelse og valg skrevet før Start følger med timeren; kladdens tekst ryddes.
        set(s => ({ timer: { ...s.draft, startedAt: now.toISOString() }, draft: { ...s.draft, description: '' } }));
      },
      stopTimer: (now = new Date()) => {
        const { timer } = get();
        if (!timer)
          return null;
        const entry = stopTimer(timer, now, newId());
        const { description: _d, ...keep } = timer;
        set(s => ({
          timer: null,
          entries: entry ? [entry, ...s.entries] : s.entries,
          draft: { ...keep, description: '' },
        }));
        return entry;
      },
      discardTimer: () => set({ timer: null }),
      updateTimer: patch => set(s => (s.timer ? { timer: { ...s.timer, ...patch } } : {})),
      addEntry: e => set(s => ({ entries: [{ ...e, id: newId(), createdAt: nowIso() }, ...s.entries] })),
      updateEntry: (id, patch) => set(s => ({ entries: s.entries.map(e => (e.id === id ? { ...e, ...patch } : e)) })),
      deleteEntry: id => set(s => ({ entries: s.entries.filter(e => e.id !== id) })),
      addClient: (name) => {
        const id = newId();
        set(s => ({ clients: [...s.clients, { id, name: name.trim(), createdAt: nowIso() }] }));
        return id;
      },
      addProject: (name, clientId) => {
        const id = newId();
        set(s => ({ projects: [...s.projects, { id, name: name.trim(), clientId, createdAt: nowIso() }] }));
        return id;
      },
      addTag: (name) => {
        const id = newId();
        set(s => ({
          tags: [...s.tags, { id, name: name.trim(), color: TAG_COLORS[s.tags.length % TAG_COLORS.length]!, createdAt: nowIso() }],
        }));
        return id;
      },
      deleteClient: id => set(s => ({ ...removeClient(s, id), draft: s.draft.clientId === id ? { ...s.draft, clientId: null } : s.draft })),
      deleteProject: id => set(s => ({ ...removeProject(s, id), draft: s.draft.projectId === id ? { ...s.draft, projectId: null } : s.draft })),
      deleteTag: id => set(s => ({ ...removeTag(s, id), draft: { ...s.draft, tagIds: s.draft.tagIds.filter(t => t !== id) } })),
      setRemoteId: (localId, remoteId) => set(s => ({ remoteIds: { ...s.remoteIds, [localId]: remoteId } })),
      deferImport: () => set({ importDeferred: true }),
      dismissBanner: () => set({ bannerDismissed: true }),
      clearAll: () => set({ ...INITIAL }),
    }),
    {
      name: LOCAL_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => mmkvStorage),
      partialize: s => ({
        enabled: s.enabled,
        clients: s.clients,
        projects: s.projects,
        tags: s.tags,
        entries: s.entries,
        timer: s.timer,
        draft: s.draft,
        remoteIds: s.remoteIds,
        bannerDismissed: s.bannerDismissed,
      }) as LocalStore,
    },
  ),
);

export const useLocalStore = createSelectors(_useLocalStore);
export const localStore = () => _useLocalStore.getState();
