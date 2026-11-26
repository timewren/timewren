import { isTRPCClientError } from './trpc';

/** Kendetegn på en forbigående netværksfejl — appen kan intet, og det er ikke en fejl i appen. */
const NETWORK_HINTS = ['network request failed', 'failed to fetch', 'networkerror'];

/** Koder der er almindelige brugerfejl (udløbet login, manglet adgang, dårligt input). */
const USER_ERROR_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST', 'NOT_FOUND']);

/** Sand hvis beskeden er den, fetch giver ved tabt forbindelse. */
export function hasNetworkHint(message: string): boolean {
  const lower = message.toLowerCase();
  return NETWORK_HINTS.some(hint => lower.includes(hint));
}

/** Sand hvis fejlen er en tRPC-fejl, der skyldes tabt forbindelse. */
export function isNetworkFailure(error: unknown): boolean {
  if (!isTRPCClientError(error))
    return false;

  // Ved netfejl er beskeden fra fetch'en ("Network request failed"), og den
  // kan også ligge på `cause` hvis den er blevet pakket ind.
  return [error.message, error.cause?.message ?? ''].some(hasNetworkHint);
}

/**
 * Hvad der skal sendes til crash-rapportering.
 * Kun uventede serverfejl og ukendte fejl rapporteres — tabt net og brugerfejl er støj.
 */
export function shouldReportError(error: unknown): boolean {
  if (isNetworkFailure(error))
    return false;

  if (isTRPCClientError(error) && error.data?.code && USER_ERROR_CODES.has(error.data.code))
    return false;

  return true;
}
