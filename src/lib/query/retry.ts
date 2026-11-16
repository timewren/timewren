import { isNetworkError } from "@/lib/offline/queue";

/**
 * Genforsøg for queries: netværksfejl (forbindelsen faldt kort ud, fx ved
 * skift fra wifi til mobilnet, hvor Chrome afbryder kald med
 * ERR_NETWORK_CHANGED) prøves op til tre gange med React Querys stigende
 * pause; andre fejl én gang som hidtil.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  return failureCount < (isNetworkError(error) ? 3 : 1);
}
