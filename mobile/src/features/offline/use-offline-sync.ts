import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import * as React from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { drainQueue } from './drain';
import { nextWakeupAt, pendingCount } from './queue-logic';
import { offlineQueue, useOfflineQueue } from './queue-store';

/** `setTimeout`-loft: en baggrundstimer må ikke fyre for tidligt. */
const MAX_WAKEUP_MS = 5 * 60_000;

/**
 * Dræner offline-køen ved online-overgang, når appen kommer i forgrunden, og
 * når et element i backoff bliver klar til et nyt forsøg. Monteres én gang i
 * (app)-layoutet. Invaliderer tid/klippekort/dashboard/timer efter en
 * vellykket dræning, så listerne viser serverens sandhed.
 */
export function useOfflineSync() {
  const utils = trpc.useUtils();
  const items = useOfflineQueue.use.items();
  const pending = pendingCount(items);
  const caps = useCapabilities();
  // undefined = capabilities ikke kendt endnu: de hentes ikke (kolde start
  // uden net), eller hentningen fejlede. Køen filtreres da ikke, så en
  // registrering der er lagt i køen første gang efter kolde start ikke sidder
  // fast — og intet stemples med `null`, som `inActiveOrg` ikke kan holde (se
  // `orgToStamp`). Før la `isLoading` alene være afgørende, så et fejlet kald
  // stemplede køen med `null` og posten lå strandet for evigt.
  const orgId = caps.isLoading || caps.isError ? undefined : caps.orgId;

  // Stempl nye elementer med den aktive org, så et org-skift ikke dræner dem
  // mod den nye organisations data.
  const setActiveOrgId = useOfflineQueue.use.setActiveOrgId();
  React.useEffect(() => {
    setActiveOrgId(orgId);
  }, [orgId, setActiveOrgId]);

  const sync = React.useCallback(async () => {
    const activeOrgId = offlineQueue().activeOrgId;
    if (!onlineManager.isOnline() || pendingCount(offlineQueue().items) === 0)
      return;
    const result = await drainQueue({ activeOrgId });
    if (result.succeeded > 0) {
      void utils.time.invalidate();
      void utils.prepaid.invalidate();
      void utils.dashboard.invalidate();
      void utils.timerSync.invalidate();
      showMessage({ message: translate('offline.synced', { count: result.succeeded }), type: 'success' });
    }
  }, [utils]);

  // Nyt login: elementer, der ventede på login (`resumeAfterLogin`), sendes nu.
  const authStatus = useAuthStore.use.status();
  React.useEffect(() => {
    if (authStatus === 'signIn')
      void sync();
  }, [authStatus, sync]);

  // Online-overgang (expo-network) — spejles i køens isOnline til banneret.
  React.useEffect(() => {
    offlineQueue().setOnline(onlineManager.isOnline());
    const sub = Network.addNetworkStateListener((state) => {
      const online = state.isInternetReachable ?? state.isConnected ?? true;
      const was = offlineQueue().isOnline;
      offlineQueue().setOnline(online);
      if (online && !was)
        void sync();
    });
    return () => sub.remove();
  }, [sync]);

  // Forgrund
  React.useEffect(() => {
    void sync();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active')
        void sync();
    });
    return () => sub.remove();
  }, [sync]);

  // Noget nyt i køen mens vi er online (fx transient fejl der er "kommet sig") → prøv med det samme.
  React.useEffect(() => {
    if (pending > 0)
      void sync();
  }, [pending, sync]);

  // Et element i backoff skal prøves igen, når ventetiden er over — ikke
  // først næste gang brugeren skifter app. Uden dette hang synkningen på
  // tilfældige hændelser.
  React.useEffect(() => {
    if (!onlineManager.isOnline())
      return;
    const wakeupAt = nextWakeupAt(items, Date.now(), orgId);
    if (wakeupAt === null)
      return;
    const delay = Math.min(Math.max(wakeupAt - Date.now(), 0), MAX_WAKEUP_MS);
    const timer = setTimeout(() => {
      void sync();
    }, delay);
    return () => clearTimeout(timer);
  }, [items, orgId, sync]);

  return { sync };
}
