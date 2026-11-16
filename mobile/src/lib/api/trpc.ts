import type { TRPCLink } from '@trpc/client';
import type { AppRouter } from '~/api/app-router';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';
import { getApiUrl } from '~/features/server/server-config';
import { authHeaders } from '~/lib/auth/client';
import { clearClientTooOld, clientVersionHeaders, isClientTooOld, isGuardedWrite, markClientTooOld } from './client-version';

const TRPC_URL = `${getApiUrl()}/api/trpc`;

/** Klientversion + session — til alle kald mod backenden. */
export async function backendHeaders(): Promise<Record<string, string>> {
  return { ...clientVersionHeaders(), ...(await authHeaders()) };
}

/**
 * Opdager CLIENT_TOO_OLD på ethvert kald (også offline-køens vanilla-klient)
 * og viser den blokerende opdateringsbesked. Fejlen sendes uændret videre.
 * Går en beskyttet skrivning igennem igen, lukkes beskeden.
 */
const clientTooOldLink: TRPCLink<AppRouter> = () => ({ next, op }) =>
  observable(observer =>
    next(op).subscribe({
      next: (value) => {
        if (isGuardedWrite(op.path, op.type))
          clearClientTooOld();
        observer.next(value);
      },
      error: (error) => {
        if (isClientTooOld(error))
          markClientTooOld();
        observer.error(error);
      },
      complete: () => observer.complete(),
    }));

function makeLinks() {
  return [
    clientTooOldLink,
    httpBatchLink({
      url: TRPC_URL,
      transformer: superjson,
      headers: () => backendHeaders(),
    }),
  ];
}

/** React-hooks: `trpc.time.list.useQuery()` osv. */
export const trpc = createTRPCReact<AppRouter>();

export function createReactTRPCClient() {
  return trpc.createClient({ links: makeLinks() });
}

/** Vanilla-klient til brug uden for React (stores, offline-kø, baggrund). */
export const trpcClient = createTRPCClient<AppRouter>({ links: makeLinks() });

export function isTRPCClientError(
  error: unknown,
): error is TRPCClientError<AppRouter> {
  return error instanceof TRPCClientError;
}

/** Brugervenlig fejlbesked fra en tRPC-fejl (dansk fallback). */
export function errorMessage(error: unknown, fallback = 'Noget gik galt'): string {
  if (isTRPCClientError(error)) {
    if (error.data?.code === 'UNAUTHORIZED')
      return 'Du er logget ud. Log ind igen.';
    if (error.data?.code === 'FORBIDDEN')
      return 'Du har ikke adgang til dette.';
    if (isClientTooOld(error))
      return 'Din TimeTrack-app er for gammel — opdatér for at fortsætte';
    return error.message || fallback;
  }
  if (error instanceof Error)
    return error.message || fallback;
  return fallback;
}
