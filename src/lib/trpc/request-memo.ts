/**
 * Request-scoped memo til tRPC-middlewaren.
 *
 * En batch fra web (httpBatchLink) deler én kontekst, men hver procedure
 * kører middlewaren for sig — så aktiv org, moduler, rolle og abonnement
 * blev slået op én gang pr. procedure (10 procedurer = 10 ens opslag).
 * Med en memo i konteksten deler procedurerne i samme HTTP-request løftet.
 *
 * Memoen lever kun så længe konteksten: /api/trpc og REST-API'et opretter en
 * ny pr. request. Kald uden memo (createCaller i tests, server-callers)
 * opfører sig som før. En afvist løfte gemmes ikke, så en fejl ikke
 * genbruges af næste procedure.
 */
export type RequestMemo = Map<string, Promise<unknown>>;

export function createRequestMemo(): RequestMemo {
  return new Map();
}

export function memoize<T>(
  memo: RequestMemo | undefined,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!memo) return fn();
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  const promise = fn();
  memo.set(key, promise);
  promise.catch(() => {
    if (memo.get(key) === promise) memo.delete(key);
  });
  return promise;
}
