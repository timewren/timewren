import type { AuthSession } from '~/lib/auth/client';
import { onlineManager } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { create } from 'zustand';
import { forgetQuickStart } from '~/features/home/quick-start';
import { releasePushForSignOut } from '~/features/notifications/push-registration';
import { offlineQueue } from '~/features/offline/queue-store';
import { getApiUrl } from '~/features/server/server-config';
import { setPendingStop } from '~/features/timer/timer-recovery';
import { timerActions } from '~/features/timer/timer-store';
import { offlineReads, subscribeToReadAccessDenials } from '~/lib/api/offline-read-runtime';
import { cookieProof } from '~/lib/api/offline-read-storage';
import { queryClient } from '~/lib/api/provider';
import { trpcClient } from '~/lib/api/trpc';
import { authClient, getSessionCookie } from '~/lib/auth/client';
import { createSelectors } from '~/lib/utils';

type AuthStatus = 'idle' | 'signOut' | 'signIn';

type AuthState = {
  status: AuthStatus;
  session: AuthSession | null;
  checking: boolean;
  navigationKey: number;
  offlineUserId: string | null;
  /** Hent session fra backenden (cookie i SecureStore) og sæt status. */
  hydrate: (retry?: boolean) => Promise<boolean | undefined>;
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
  clearReadContext();
}

let revision = 0;
let switching = false;
let signingOut = false;

/** Så længe venter log ud højst på, at push-tokenet afmeldes. */
const PUSH_RELEASE_TIMEOUT_MS = 3_000;
async function releasePushWithin(ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([releasePushForSignOut(), timeout]);
  }
  finally {
    clearTimeout(timer);
  }
}

type SessionIdentity = { user?: { id?: string }; session?: { id?: string; expiresAt?: Date | string } };

function clearReadContext() {
  offlineReads.clear();
  queryClient.clear();
}

async function readScope(session: SessionIdentity, proof: string | null, signal?: AbortSignal) {
  const expiresAt = new Date(session.session?.expiresAt ?? 0).getTime();
  if (!(expiresAt > Date.now()) || !session.user?.id)
    return null;
  if (!proof)
    return null;
  const server = getApiUrl();
  const { org } = await trpcClient.mobile.getCapabilities.query(undefined, { signal });
  if (!org?.id || proof !== await cookieProof(await getSessionCookie()))
    return null;
  return { server, user: session.user.id, organization: org.id, session: proof, expiresAt };
}

const _useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  session: null,
  checking: false,
  navigationKey: 0,
  offlineUserId: null,
  setSession: (session) => {
    revision++;
    const identity = session as SessionIdentity | null;
    const userId = identity?.user?.id ?? null;
    const previous = get().session as SessionIdentity | null;
    const previousUser = previous?.user?.id ?? get().offlineUserId;
    const changed = !session || (get().status === 'signIn'
      && (previousUser !== userId || (previous && previous.session?.id !== identity?.session?.id)));
    if (!session || (previousUser && previousUser !== userId))
      rydBrugerBundetState();
    else if (changed)
      clearReadContext();
    if (userId)
      offlineQueue().adoptOwner(userId);
    set(state => ({
      session,
      status: session ? 'signIn' : 'signOut',
      checking: false,
      offlineUserId: null,
      navigationKey: state.navigationKey + (changed && state.status === 'signIn' ? 1 : 0),
    }));
  },
  hydrate: hydrateSession,
  signOut: async () => {
    signingOut = true;
    get().setSession(null);
    // Eksplicit log ud: brugeren har valgt det, så også køen tømmes.
    offlineQueue().clearAll();
    try {
      // Push-tokenet afmeldes FØR cookien ryger, ellers kan serveren ikke se,
      // hvis token det er. Loftet holder log ud hurtigt uden net.
      await releasePushWithin(PUSH_RELEASE_TIMEOUT_MS);
      await authClient.signOut();
    }
    catch {
      // Cookien fjernes lokalt uanset om serveren svarede.
    }
    finally {
      signingOut = false;
    }
  },
}));

async function hydrateSession(retry = false) {
  if (switching || signingOut)
    return;
  const request = ++revision;
  const previousScope = offlineReads.current();
  const wasSignedIn = _useAuthStore.getState().status === 'signIn';
  if (!retry)
    _useAuthStore.setState({ checking: true });
  // Afbryd gamle reads inden TanStack Query genoptager ved net.
  void queryClient.cancelQueries();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let proof: string | null = null;
  let verifiedUser: string | undefined;
  let cookie: string | null;
  try {
    cookie = await getSessionCookie();
  }
  catch (error) {
    clearTimeout(timeout);
    // En forældet læsning må ikke overskrive en nyere hydrering eller et log ud.
    if (request !== revision)
      return;
    // Kan cookien ikke læses (SecureStore) ved opstart, ved vi intet om
    // sessionen: afvis, så opstarten viser fejlskærmen med Prøv igen.
    if (!wasSignedIn) {
      _useAuthStore.setState({ checking: false });
      throw error;
    }
    // Allerede logget ind (netværksskift, organisationsskift): byg læsekontekst
    // og navigation op på ny mod serverens aktuelle session i stedet for at
    // afvise et skift, serveren allerede har udført.
    clearReadContext();
    _useAuthStore.setState(state => ({ status: 'signIn', checking: false, navigationKey: state.navigationKey + 1 }));
    return true;
  }
  try {
    if (request !== revision)
      return;
    if (!cookie) {
      _useAuthStore.getState().setSession(null);
      return true;
    }
    proof = await cookieProof(cookie);
    if (request !== revision)
      return;
    if (!retry && !onlineManager.isOnline()) {
      openOffline(proof);
      return;
    }
    const { data, error } = await authClient.getSession({ query: { disableCookieCache: true }, fetchOptions: { signal: controller.signal } });
    if (request !== revision)
      return;
    if (error && error.status !== 401 && error.status !== 403)
      throw error;
    const session = error ? null : data;
    if (!session) {
      _useAuthStore.getState().setSession(null);
      return true;
    }
    verifiedUser = session.user.id;
    const scope = await readScope(session, proof, controller.signal);
    if (request !== revision)
      return;
    const sameContext = scope && previousScope?.server === scope.server && previousScope.session === scope.session
      && previousScope.organization === scope.organization && previousScope.user === scope.user;
    if (wasSignedIn && !sameContext)
      resetReadNavigation();
    _useAuthStore.getState().setSession(session);
    if (scope) {
      offlineReads.restore(scope.server, scope.session, scope);
      offlineReads.activate(scope);
    }
    else {
      offlineReads.clear();
    }
    if (sameContext)
      void queryClient.resetQueries();
    return true;
  }
  catch (error) {
    if (request !== revision)
      return;
    if (error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') {
      _useAuthStore.getState().setSession(null);
      return true;
    }
    if (proof && isTemporaryFailure(error)) {
      const currentProof = await getSessionCookie().then(cookieProof).catch(() => null);
      if (request !== revision)
        return;
      onlineManager.setOnline(false);
      openOffline(currentProof === proof ? proof : null, verifiedUser);
      return;
    }
    clearReadContext();
    _useAuthStore.setState(state => ({ status: 'signIn', checking: false, navigationKey: state.navigationKey + 1 }));
    return true;
  }
  finally {
    clearTimeout(timeout);
  }
}

function isTemporaryFailure(error: unknown) {
  const status = error instanceof TRPCClientError
    ? error.data?.httpStatus ?? (error.meta?.response as Response | undefined)?.status
    : error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (typeof status === 'number' && status >= 500 && status < 600)
    return true;
  const cause = error instanceof TRPCClientError && !error.data ? error.cause : error;
  return cause instanceof TypeError || (cause instanceof Error && cause.name === 'AbortError');
}

function resetReadNavigation() {
  forgetQuickStart();
  queryClient.clear();
  _useAuthStore.setState(state => ({ navigationKey: state.navigationKey + 1 }));
}

function openOffline(proof: string | null, verifiedUser?: string) {
  const previous = offlineReads.current();
  let restored = proof ? offlineReads.restore(getApiUrl(), proof) : null;
  if (!restored || (verifiedUser && restored.user !== verifiedUser)) {
    offlineReads.clear();
    restored = null;
  }
  if (previous && previous !== restored)
    resetReadNavigation();
  _useAuthStore.setState({ status: 'signIn', checking: false, offlineUserId: restored?.user ?? null });
}

subscribeToReadAccessDenials((code) => {
  if (code === 'UNAUTHORIZED') {
    _useAuthStore.getState().setSession(null);
  }
  else {
    revision++;
    resetReadNavigation();
    _useAuthStore.setState({ checking: false });
  }
});

export const useAuthStore = createSelectors(_useAuthStore);

export const hydrateAuth = (retry = false) => _useAuthStore.getState().hydrate(retry);
export const signOut = () => _useAuthStore.getState().signOut();

export function setSession(session: AuthSession | null) {
  offlineReads.clear();
  _useAuthStore.getState().setSession(session);
  const request = revision;
  if (session && onlineManager.isOnline()) {
    void getSessionCookie().then(cookieProof).then(proof => readScope(session, proof)).then((scope) => {
      if (scope && request === revision) {
        offlineReads.activate(scope);
        void queryClient.invalidateQueries();
      }
    }).catch(() => {});
  }
}

export async function changeActiveOrganization(change: () => Promise<void>) {
  const request = ++revision;
  switching = true;
  _useAuthStore.setState({ checking: true });
  forgetQuickStart();
  clearReadContext();
  try {
    await change();
  }
  finally {
    switching = false;
    if (request === revision)
      await hydrateAuth();
  }
}
