import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { captureError } from '~/lib/monitoring';
import { authClient } from './client';

/** Sign in with Apple er kun tilgængeligt på iOS 13+ (native ark). */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios')
    return false;
  return AppleAuthentication.isAvailableAsync();
}

/**
 * Native Sign in with Apple: henter et identity token fra Apple og veksler det til
 * en better-auth-session (verificeres server-side mod appens bundle-id).
 * Nonce beskytter mod replay: rå nonce sendes til better-auth, SHA-256 af den til Apple.
 */
export async function signInWithApple(): Promise<void> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential.identityToken)
    throw new Error('Apple returnerede intet identity token');
  const user = appleUser(credential);
  const { error } = await authClient.signIn.social({
    provider: 'apple',
    idToken: { token: credential.identityToken, nonce: rawNonce, ...(user && { user }) },
  });
  if (error)
    throw error;
}

/**
 * Navnet giver Apple KUN ved første login (det står ikke i identity tokenet).
 * Uden det her fik nye Apple-brugere intet navn, og arbejdspladsen, serveren
 * opretter, blev navngivet efter ingenting.
 */
function appleUser(credential: Pick<AppleAuthentication.AppleAuthenticationCredential, 'fullName' | 'email'>) {
  const firstName = credential.fullName?.givenName ?? undefined;
  const lastName = credential.fullName?.familyName ?? undefined;
  if (!firstName && !lastName)
    return undefined;
  return { name: { firstName, lastName }, email: credential.email ?? undefined };
}

/**
 * Frisk authorization code til kontosletning (Apple 5.1.1(v): Apple-login skal tilbagekaldes).
 * Det native login gemmer intet Apple-token på serveren, så appen beder Apple om en ny kode
 * (gyldig i 5 minutter), som serveren veksler til et token og tilbagekalder efter sletningen.
 *
 * - `null`: ikke iOS, ingen Apple-login på kontoen, eller Apple fejlede. Sletningen fortsætter;
 *   serveren logger manglende tilbagekaldelse til manuel opfølgning.
 * - `'canceled'`: brugeren lukkede Apple-arket. Sletningen afbrydes.
 */
export async function appleCodeForAccountDeletion(): Promise<string | null | 'canceled'> {
  if (Platform.OS !== 'ios')
    return null;
  try {
    const { data, error } = await authClient.listAccounts();
    if (error)
      throw new Error(`listAccounts: ${error.message ?? error.status}`);
    const accounts = (data ?? []) as Array<{ providerId?: string }>;
    if (!accounts.some(a => a.providerId === 'apple') || !(await isAppleSignInAvailable()))
      return null;
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    return credential.authorizationCode ?? null;
  }
  catch (err) {
    if (isAppleCancel(err))
      return 'canceled';
    // Sletningen må ikke blokeres af Apple; serveren logger manglende tilbagekaldelse.
    captureError(err);
    return null;
  }
}

/** Brugeren afbrød Apple-arket — skal ikke vises som fejl. */
export function isAppleCancel(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ERR_REQUEST_CANCELED';
}
