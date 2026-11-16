/**
 * better-auth 1.7.7 (opgave 7b) gjorde expo-plugin'ets `getCookie()` **async** —
 * 1.6.25 læste den sync fra SecureStore. Appen caster den ikke længere til
 * `() => string`, så `authHeaders()` blev et `Promise`.
 *
 * Det er præcis den slags fejl ingen type-check og ingen test dømmer: `fetch`
 * og tRPC tager gerne ethvert objekt som `headers`, og en `Promise` i headeren
 * bliver `[object Promise]` — altså **ingen cookie**. Brugeren så bare en app
 * der var logget ud igen ved hvert kald, uden at nogen kunne sige hvorfor.
 *
 * Denne test dømmer den *faktiske* Cookie-streng på det wire-format, tRPC
 * ville sende, så en synkron afvigelse igen er rød. Den går gennem den rigtige
 * `trpcClient` (kun `auth/client` er mocket — samme mock som appens øvrige tests).
 */
// `__setCookie` findes kun i mocken (jest's moduleNameMapper), ikke i den
// ægte `~/lib/auth/client` — derfor den lokale type.
import * as authClientMock from '~/lib/auth/client';
import { trpcClient } from './trpc';

const __setCookie = (authClientMock as unknown as {
  __setCookie: (value: string) => void;
}).__setCookie;

type FetchInit = { headers?: Record<string, string> };

let capturedHeaders: Record<string, string> | null = null;

beforeAll(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
    async (_url: string, init: FetchInit) => {
      capturedHeaders = init?.headers ?? null;
      return new Response(JSON.stringify([{ result: { data: null } }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
});

afterEach(() => {
  capturedHeaders = null;
  jest.clearAllMocks();
});

async function kaldOgLæsHeaders(): Promise<Record<string, string>> {
  // `trpcClient` er typet fra web's AppRouter; vi kalder den procedure, der
  // kræver mindst input, fordi det her er wire-formatet der er pointen.
  await (trpcClient.time as { todayTotal: { query: () => Promise<unknown> } })
    .todayTotal
    .query()
    .catch(() => undefined);
  expect(capturedHeaders).not.toBeNull();
  return capturedHeaders as unknown as Record<string, string>;
}

describe('auth-headeren på tRPC-kald', () => {
  it('sender cookien som en streng, ikke som et [object Promise]', async () => {
    __setCookie('better-auth.session_token=abc123');

    const headers = await kaldOgLæsHeaders();

    expect(headers.Cookie).toBe('better-auth.session_token=abc123');
    __setCookie('');
  });

  it('sender ingen Cookie-header, når brugeren er logget ud', async () => {
    __setCookie('');

    const headers = await kaldOgLæsHeaders();

    expect(headers.Cookie).toBeUndefined();
  });
});
