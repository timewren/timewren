import { getSetCookie } from '@better-auth/expo/client';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { hydrateAuth } from '~/features/auth/use-auth-store';
import { isTimeWren } from '~/features/server/server-config';

const COOKIE_KEY = 'timetrack_cookie'; // = `${storagePrefix}_cookie` i authClient

/**
 * Magic link åbner appen via `timetrack://...?cookie=...` (better-auth's
 * expo-plugin lægger sessionscookien i URL'en, når callbackURL er appens scheme).
 * Sociale logins håndteres af expoClient selv; dette dækker kold start fra e-mail.
 */
export async function handleAuthDeepLink(url: string | null): Promise<boolean> {
  if (isTimeWren || !url)
    return false;
  let cookie: string | null = null;
  try {
    cookie = new URL(url).searchParams.get('cookie');
  }
  catch {
    return false;
  }
  if (!cookie)
    return false;
  const prev = await SecureStore.getItemAsync(COOKIE_KEY);
  await SecureStore.setItemAsync(COOKIE_KEY, getSetCookie(cookie, prev ?? undefined));
  await hydrateAuth();
  return true;
}

/** Lyt efter auth-deep-links mens appen kører. Returnerer unsubscribe. */
export function subscribeAuthDeepLinks(): () => void {
  // Et link kan fejle ved opslag eller lagring. Den almindelige loginvej er stadig tilgængelig.
  const ignoreLinkFailure = () => {};
  const sub = Linking.addEventListener('url', ({ url }) => {
    void handleAuthDeepLink(url).catch(ignoreLinkFailure);
  });
  void Linking.getInitialURL().then(handleAuthDeepLink).catch(ignoreLinkFailure);
  return () => sub.remove();
}
