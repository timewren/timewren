/* eslint-disable react-refresh/only-export-components */
import { useReactQueryDevTools } from '@dev-plugins/react-query';
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import * as Network from 'expo-network';
import * as React from 'react';
import { AppState, Platform } from 'react-native';
import { captureError } from '~/lib/monitoring';
import { shouldReportError } from './error-reporting';
import { createReactTRPCClient, isTRPCClientError, trpc } from './trpc';

const FIVE_MINUTES = 5 * 60 * 1000;
const RECONNECT_INTERVAL = 30_000;

// Kun uventede serverfejl sendes til crash-rapportering — tabt net og
// brugerfejl (udløbet login, manglet adgang) ville bare fylde Sentry med støj.
function reportQueryError(error: unknown) {
  if (!shouldReportError(error))
    return;
  captureError(error);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportQueryError }),
  mutationCache: new MutationCache({ onError: reportQueryError }),
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES,
      gcTime: 24 * 60 * 60 * 1000,
      retry: (count, error) => {
        const code = isTRPCClientError(error) ? error.data?.code : undefined;
        return code !== 'UNAUTHORIZED' && code !== 'FORBIDDEN' && count < 2;
      },
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Refetch når appen kommer i forgrunden (TanStack Query kender ikke RN's AppState).
function useAppFocus() {
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (Platform.OS !== 'web')
        focusManager.setFocused(status === 'active');
    });
    return () => sub.remove();
  }, []);
}

// Online-status fra enheden, så queries pauser offline og genoptager ved net.
function useOnlineStatus(onNetworkReady: (retry: boolean) => Promise<boolean | undefined>) {
  React.useEffect(() => {
    let stopped = false;
    let last: boolean | undefined;
    let retrying = false;
    const retrySession = async () => {
      if (retrying)
        return;
      retrying = true;
      try {
        if (await onNetworkReady(true) && !stopped && last === true)
          onlineManager.setOnline(true);
      }
      finally {
        retrying = false;
      }
    };
    const update = (state: Network.NetworkState) => {
      const online = state.isInternetReachable ?? state.isConnected ?? true;
      if (stopped || (last === online && onlineManager.isOnline() === online))
        return;
      const initial = last === undefined;
      last = online;
      if (online && !initial && !onlineManager.isOnline()) {
        void retrySession();
        return;
      }
      if (online)
        void onNetworkReady(false);
      onlineManager.setOnline(online);
      if (initial && !online)
        void onNetworkReady(false);
    };
    const sub = Network.addNetworkStateListener(update);
    void Network.getNetworkStateAsync().then((state) => {
      if (last === undefined)
        update(state);
    }).catch(() => {
      if (last === undefined)
        update({});
    });
    const focusSub = AppState.addEventListener('change', (status) => {
      if (status === 'active' && last === true && !onlineManager.isOnline())
        void Network.getNetworkStateAsync().then(update).catch(() => {});
    });
    // A reachable network can outlive a temporary failure to reach the server.
    const retry = setInterval(() => {
      if (AppState.currentState === 'active' && last === true && !onlineManager.isOnline())
        void retrySession();
    }, RECONNECT_INTERVAL);
    return () => {
      stopped = true;
      clearInterval(retry);
      sub.remove();
      focusSub.remove();
    };
  }, [onNetworkReady]);
}

export function APIProvider({ children, onNetworkReady }: { children: React.ReactNode; onNetworkReady: (retry: boolean) => Promise<boolean | undefined> }) {
  const [trpcClient] = React.useState(createReactTRPCClient);
  useReactQueryDevTools(queryClient);
  useAppFocus();
  useOnlineStatus(onNetworkReady);
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
