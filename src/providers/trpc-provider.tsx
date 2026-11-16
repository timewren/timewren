"use client";

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useEffect, useState } from "react";
import superjson from "superjson";
import { ORG_OVERRIDE_HEADER } from "@/lib/auth/org-header";
import {
  isClientTooOldClientError,
  webClientHeaders,
} from "@/lib/client-version/browser";
import { showUpdatePrompt } from "@/lib/pwa/update-prompt";
import {
  BUILD_VERSION,
  isNewDeployment,
  SERVER_VERSION_HEADER,
} from "@/lib/pwa/version";
import {
  broadcastDataChange,
  subscribeDataChanges,
} from "@/lib/query/cross-tab";
import {
  domainsForMutationPath,
  focusRefetchFor,
  remoteInvalidatorFor,
} from "@/lib/query/invalidate-domains";
import { shouldRetryQuery } from "@/lib/query/retry";
import { getTabId, TAB_ID_HEADER } from "@/lib/query/tab-id";
import {
  mutationPathFromKey,
  shouldInvalidateAfterMutation,
} from "@/lib/query-invalidation";
import { appUrlEnv } from "@/lib/runtime-env";
import { friendlyErrorLink } from "@/lib/trpc/friendly-error";
import type { AppRouter } from "@/lib/trpc/routers";

export const trpc = createTRPCReact<AppRouter>();

// Get base URL dynamically to handle different ports
const getBaseURL = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return appUrlEnv() || "http://localhost:3000";
};

let newVersionPrompted = false;

/**
 * Alle tRPC-kald: cookies med, og serverens build sammenlignes med fanens —
 * kører serveren en nyere build, vises "Ny version — genindlæs" med det
 * samme i stedet for først ved næste /api/version-tjek.
 */
async function trpcFetch(
  url: RequestInfo | URL,
  options?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, { ...options, credentials: "include" });
  if (!newVersionPrompted) {
    const serverVersion = res.headers.get(SERVER_VERSION_HEADER);
    if (isNewDeployment(BUILD_VERSION, serverVersion)) {
      newVersionPrompted = true;
      showUpdatePrompt("new_version");
    }
  }
  return res;
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 1000 * 60 * 5, // 5 minutes
          gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
          // Bevidst slået fra: flere redigeringssider spejler query-data ind i
          // lokal state via useEffect (company, e-mail-skabeloner, enterprise-
          // indstillinger) og ville nulstille brugerens indtastning ved en
          // fokus-refetch. Frisk data efter egne handlinger sikres af
          // mutationCache nedenfor. Undtagelse: tidsliste, klippekort,
          // kundeside og dashboard-widgets hentes igen ved fokus, så ændringer
          // fra extension/mobil ses selv når realtime (SSE) er nede.
          refetchOnWindowFocus: focusRefetchFor,
          refetchOnReconnect: false, // Don't refetch on reconnect
          retry: shouldRetryQuery,
        },
      },
      // Sikkerhedsnet: enhver vellykket mutation invaliderer cachen, så en
      // glemt utils.x.invalidate() ikke længere betyder "refresh siden".
      // Støjende mutationer (timer-heartbeat m.m.) er undtaget — se
      // src/lib/query-invalidation.ts.
      mutationCache: new MutationCache({
        // Serveren afviser skrivninger fra en for gammel fane (CLIENT_TOO_OLD):
        // vis genindlæs-prompten tydeligt — fanen kan ikke gemme før reload.
        onError: (error) => {
          if (isClientTooOldClientError(error)) showUpdatePrompt("too_old");
        },
        onSuccess: (_data, _variables, _context, mutation) => {
          const key = mutation.options.mutationKey;
          if (shouldInvalidateAfterMutation(key)) {
            void client.invalidateQueries();
            // De andre faner i browseren skal se det samme. Uden domænekort
            // kun mutationens egen router — ikke alt, så åbne formularer i
            // andre faner ikke refetches unødigt.
            const path = mutationPathFromKey(key);
            broadcastDataChange(
              path
                ? (domainsForMutationPath(path) ?? [path.split(".")[0]])
                : "all",
            );
          }
        },
      }),
    });
    return client;
  });

  // Ændringer fra andre faner (BroadcastChannel "tt-data").
  useEffect(() => {
    const invalidator = remoteInvalidatorFor(queryClient);
    return subscribeDataChanges((msg) => invalidator.push(msg.domains));
  }, [queryClient]);
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        // Danske fejltekster i stedet for "Failed to fetch", zod-JSON og
        // databasefejl, så sidernes toast.error(error.message) kan læses.
        friendlyErrorLink(),
        // Kald med en eksplicit org (offline-køens afspilning) sendes alene,
        // så headeren ikke smitter af på andre kald i samme batch.
        splitLink({
          condition: (op) => typeof op.context.orgId === "string",
          true: httpLink({
            url: `${getBaseURL()}/api/trpc`,
            transformer: superjson,
            headers: ({ op }) => ({
              ...webClientHeaders(),
              [ORG_OVERRIDE_HEADER]: String(op.context.orgId),
              [TAB_ID_HEADER]: getTabId(),
            }),
            fetch: trpcFetch,
          }),
          false: httpBatchLink({
            url: `${getBaseURL()}/api/trpc`,
            transformer: superjson,
            // Fanens id følger med, så serverens data_changed-event kan
            // genkendes som eget ekko (se lib/query/tab-id.ts).
            headers: () => ({
              ...webClientHeaders(),
              [TAB_ID_HEADER]: getTabId(),
            }),
            fetch: trpcFetch,
          }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
