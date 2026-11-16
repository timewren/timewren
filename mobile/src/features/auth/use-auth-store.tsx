import type { AuthSession } from '~/lib/auth/client';
import { create } from 'zustand';
import { forgetQuickStart } from '~/features/home/quick-start';
import { offlineQueue } from '~/features/offline/queue-store';
import { setPendingStop } from '~/features/timer/timer-recovery';
import { timerActions } from '~/features/timer/timer-store';
import { queryClient } from '~/lib/api/provider';
import { authClient, getSessionCookie } from '~/lib/auth/client';
import { setMonitoringUser } from '~/lib/monitoring';
import { createSelectors } from '~/lib/utils';

type AuthStatus = 'idle' | 'signOut' | 'signIn';

type AuthState = {
  status: AuthStatus;
  session: AuthSession | null;
  /** Hent session fra backenden (cookie i SecureStore) og sæt status. */
  hydrate: () => Promise<void>;
  /** Kaldes efter et vellykket login-flow. */
  setSession: (session: AuthSession | null) => void;
  signOut: () => Promise<void>;
};

/**
 * Alt lokalt state, der er bundet til den konto, der lige nu er logget ind.
 *
 * Det ryddes på BEGGE veje ud af en session: ved eksplicit log ud, men også
 * når sessionen forsvinder under os — en udløbet eller tilbagekaldt cookie
 * ender i `setSession(null)`. Uden den anden vej ville næste konto på en delt
 * enhed arve den forrige brugers kunde- og projektnavne, en stop-journal med
 * hans kunde-id og et timertilstand, der gemmer hans tid.
 *
 * Offline-køen er bevidst IKKE her: den er usendt tid, og en udløbet session er
 * ikke et valg. Den tømmes i stedet, når en ANDEN konto logger ind
 * (`adoptOwner`), så brugeren får sin egen kø tilbage, men ikke en fremmed.
 */
function rydBrugerBundetState() {
  timerActions().reset(0);
  setPendingStop(null);
  // Den hurtige start er kundens og projektets navn og id — den må ikke
  // overleve, ellers starter næste konto på enheden en fremmed kundes
  // arbejde med ét tryk.
  forgetQuickStart();
  queryClient.clear();
  setMonitoringUser(null);
}

const _useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  session: null,
  setSession: (session) => {
    const userId = (session as { user?: { id?: string } } | null)?.user?.id ?? null;
    setMonitoringUser(userId);
    if (!session)
      rydBrugerBundetState();
    else if (userId)
      // Køen er skrevet af denne konto. Havde en ANDEN konto skrevet den,
      // tømmer den, så B ikke dræner A's usendte tid mod sin egen konto.
      offlineQueue().adoptOwner(userId);
    set({ session, status: session ? 'signIn' : 'signOut' });
  },
  hydrate: async () => {
    // Uden cookie er vi logget ud — spar netværkskaldet.
    if (!(await getSessionCookie())) {
      get().setSession(null);
      return;
    }
    // Cookie findes: vis appen med det samme og bekræft sessionen i baggrunden —
    // sparer en hel netværks-rundtur før profil og skærme kan hente data.
    if (get().status === 'idle')
      set({ status: 'signIn' });
    try {
      const { data } = await authClient.getSession();
      get().setSession(data ?? null);
    }
    catch {
      // Offline eller server nede: behold tidligere session-status hvis vi har en,
      // ellers antag logget ind (cookien findes) og lad tRPC melde 401.
      if (get().status === 'idle')
        set({ status: 'signIn' });
    }
  },
  signOut: async () => {
    try {
      await authClient.signOut();
    }
    catch {
      // Cookien fjernes lokalt uanset om serveren svarede.
    }
    rydBrugerBundetState();
    // Eksplicit log ud: brugeren har valgt det, så også køen tømmes.
    offlineQueue().clearAll();
    set({ status: 'signOut', session: null });
  },
}));

export const useAuthStore = createSelectors(_useAuthStore);

export const hydrateAuth = () => _useAuthStore.getState().hydrate();
export const signOut = () => _useAuthStore.getState().signOut();
export function setSession(session: AuthSession | null) {
  return _useAuthStore.getState().setSession(session);
}
