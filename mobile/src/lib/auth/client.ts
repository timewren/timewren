import type { BetterAuthClientPlugin } from 'better-auth/client';
import { expoClient } from '@better-auth/expo/client';
import {
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import Env from 'env';
import * as SecureStore from 'expo-secure-store';
import { authStoragePrefix, getApiUrl, timewrenBrand } from '~/features/server/server-config';
import { clientVersionHeaders } from '~/lib/api/client-version';

/**
 * better-auth-klient til native. Sessionscookien gemmes i Keychain/Keystore
 * via SecureStore, og `authClient.getCookie()` bruges til tRPC-kald.
 */
// @better-auth/expo 1.6.25's plugin-type matcher ikke core's BetterAuthClientPlugin
// under strict TS (generisk BetterFetch-parameter). Runtime er korrekt; vi caster
// og eksponerer getCookie() typet nedenfor.
const expoPlugin = expoClient({
  scheme: timewrenBrand?.scheme ?? Env.EXPO_PUBLIC_SCHEME,
  storagePrefix: authStoragePrefix(),
  storage: SecureStore,
}) as unknown as BetterAuthClientPlugin;

export const authClient = createAuthClient({
  baseURL: getApiUrl(),
  // Klientversionen også på login/session-kald (serveren afviser dem aldrig,
  // men de tæller med i fordelingen på /admin/stabilitet).
  fetchOptions: { headers: clientVersionHeaders() },
  plugins: [
    expoPlugin,
    organizationClient(),
    magicLinkClient(),
    twoFactorClient(),
  ],
});

export type AuthSession = typeof authClient.$Infer.Session;

/** Sessionscookie fra SecureStore (tom streng når logget ud). */
export function getSessionCookie(): Promise<string> {
  return authClient.getCookie();
}

/** Header-objekt til fetch-kald mod backenden (tRPC m.fl.). */
export async function authHeaders(): Promise<Record<string, string>> {
  const cookie = await getSessionCookie();
  return cookie ? { Cookie: cookie } : {};
}
