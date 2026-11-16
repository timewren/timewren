import { QueryClient } from "@tanstack/react-query";
import { isDefiniteRejection } from "./api-error";

/**
 * Fælles QueryClient for popup og ny fane. En sikker afvisning (4xx, fx
 * udløbet token) prøves ikke igen; den giver samme svar, og et nyt forsøg
 * forsinkede bare fejlen.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60, // 1 minute
        retry: (failureCount, error) =>
          failureCount < 1 && !isDefiniteRejection(error),
      },
    },
  });
}
