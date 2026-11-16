import type { AppRouter } from '~/api/app-router';
import { TRPCClientError } from '@trpc/client';
import { isNetworkFailure, shouldReportError } from './error-reporting';

function trpcError(message: string, code?: string): TRPCClientError<AppRouter> {
  return new TRPCClientError(message, {
    result: code
      ? { error: { code: -32000, message, data: { code, httpStatus: 500, path: 'x' } } }
      : undefined,
  } as any);
}

/** Som tRPC selv bygger den, når fetch'en fejler: kausen er den oprindelige netfejl. */
function networkError(message: string): TRPCClientError<AppRouter> {
  return TRPCClientError.from(new TypeError(message)) as TRPCClientError<AppRouter>;
}

describe('isNetworkFailure', () => {
  it.each([
    'Network request failed',
    'Failed to fetch',
    'TypeError: NetworkError when attempting to fetch resource.',
    'netværksfejl: FAILED TO FETCH',
  ])('genkender forbigående netværksfejl: %s', (message) => {
    expect(isNetworkFailure(trpcError(message))).toBe(true);
  });

  it('genkender en rigtig fetch-fejl pakket af tRPC', () => {
    expect(isNetworkFailure(networkError('Network request failed'))).toBe(true);
    expect(isNetworkFailure(networkError('NetworkError when attempting to fetch resource.'))).toBe(true);
  });

  it('lader serverfejl være serverfejl', () => {
    expect(isNetworkFailure(trpcError('Database kunne ikke nås', 'INTERNAL_SERVER_ERROR'))).toBe(false);
  });

  it('lader almindelige fejl være almindelige', () => {
    expect(isNetworkFailure(new Error('Network request failed'))).toBe(false);
    expect(isNetworkFailure('Network request failed')).toBe(false);
  });
});

describe('shouldReportError', () => {
  it('dæmper forbigående netværksfejl', () => {
    expect(shouldReportError(trpcError('Network request failed'))).toBe(false);
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST', 'NOT_FOUND'])('dæmper brugerfejl %s', (code) => {
    expect(shouldReportError(trpcError('Noget gik galt', code))).toBe(false);
  });

  it('rapporterer uventede serverfejl', () => {
    expect(shouldReportError(trpcError('Database kunne ikke nås', 'INTERNAL_SERVER_ERROR'))).toBe(true);
  });

  it('rapporterer ukendte fejl', () => {
    expect(shouldReportError(new TypeError('undefined is not a function'))).toBe(true);
    expect(shouldReportError('ukendt')).toBe(true);
  });
});
