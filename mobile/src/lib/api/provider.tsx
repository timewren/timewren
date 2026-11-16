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
import { createReactTRPCClient, trpc } from './trpc';

const FIVE_MINUTES = 5 * 60 * 1000;

// Kun uventede serverfejl sendes til crash-rapportering — tabt net og
// brugerfejl (udløbet login, manglet adgang) ville bare fylde Sentry med støj.
function reportQueryError(error: unknown, key: string) {
  if (!shouldReportError(error))
    return;
  captureError(error, { query: key });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => reportQueryError(error, query.queryHash) }),
  // eslint-disable-next-line max-params -- TanStack's signatur
  mutationCache: new MutationCache({ onError: (error, _v, _c, mutation) => reportQueryError(error, String(mutation.options.mutationKey ?? 'mutation')) }),
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
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
function useOnlineStatus() {
  React.useEffect(() => {
    const sub = Network.addNetworkStateListener((state) => {
      onlineManager.setOnline(state.isInternetReachable ?? state.isConnected ?? true);
    });
    return () => sub.remove();
  }, []);
}

export function APIProvider({ children }: { children: React.ReactNode }) {
  const [trpcClient] = React.useState(createReactTRPCClient);
  useReactQueryDevTools(queryClient);
  useAppFocus();
  useOnlineStatus();
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
