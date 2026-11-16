/**
 * Kryptering af OAuth-login-tokens i better-auths `account`-tabel (#710).
 *
 * - accessToken/refreshToken krypteres af better-auth selv
 *   (`account.encryptOAuthTokens`, XChaCha20-Poly1305 med BETTER_AUTH_SECRET).
 *   better-auth dekrypterer dem ved token-refresh/getAccessToken og læser
 *   gamle klartekst-rækker uændret, så længe de ikke ligner hex.
 * - idToken krypterer better-auth IKKE. Vi krypterer det i databaseHooks med
 *   encryptSecret (ENCRYPTION_KEY, "enc:v1:"-præfiks) og dekrypterer det de
 *   steder vi selv læser det (SSO auto-join).
 *
 * betterAuthTokenCodec bruges af backfill-scriptet, så eksisterende rækker
 * krypteres i præcis det format better-auth læser.
 */

import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import type { SecretCodec } from "@/lib/security/secret-backfill";
import {
  decryptSecret,
  detectSecretFormat,
  EncryptionKeyError,
  encryptSecret,
} from "@/lib/utils/encryption";

/**
 * Samme regel som better-auths `isLikelyEncrypted` (better-auth/dist/oauth2/
 * utils): "$ba$"-envelope eller hex med lige længde. Kun værdier der matcher,
 * forsøger better-auth at dekryptere — alt andet læses som klartekst.
 */
export function isLikelyBetterAuthEncrypted(token: string): boolean {
  if (token.startsWith("$ba$")) return true;
  return token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token);
}

/**
 * Nøglen better-auth krypterer OAuth-tokens med. auth.ts sætter
 * `secret: BETTER_AUTH_SECRET`; uden BETTER_AUTH_SECRETS (versionerede nøgler)
 * er better-auths secretConfig præcis den streng.
 */
function getBetterAuthTokenKey(): string {
  if (process.env.BETTER_AUTH_SECRETS) {
    throw new EncryptionKeyError(
      "BETTER_AUTH_SECRETS (versionerede nøgler) er sat — backfill understøtter kun en enkelt BETTER_AUTH_SECRET. Intet er skrevet.",
    );
  }
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new EncryptionKeyError(
      "BETTER_AUTH_SECRET mangler: OAuth-login-tokens kan ikke krypteres i better-auths format.",
    );
  }
  return secret;
}

/** Krypterer/dekrypterer som better-auths encryptOAuthTokens. */
export const betterAuthTokenCodec: SecretCodec = {
  name: "BETTER_AUTH_SECRET",
  detect: (stored) =>
    isLikelyBetterAuthEncrypted(stored) ? "prefixed" : "plaintext",
  encrypt: async (plaintext) =>
    symmetricEncrypt({ key: getBetterAuthTokenKey(), data: plaintext }),
  decrypt: async (stored) =>
    symmetricDecrypt({ key: getBetterAuthTokenKey(), data: stored }),
};

/**
 * Til databaseHooks: kryptér et idToken før det skrives. Allerede krypterede
 * værdier (fx better-auth der skriver rækkens eget idToken tilbage ved
 * token-refresh) lades urørt. Mangler ENCRYPTION_KEY, gemmes intet idToken
 * frem for klartekst — login virker stadig, kun SSO auto-join mister claims.
 */
export function protectIdToken(
  idToken: string | null | undefined,
): string | null | undefined {
  if (!idToken) return idToken;
  if (detectSecretFormat(idToken) !== "plaintext") return idToken;
  try {
    return encryptSecret(idToken);
  } catch (error) {
    console.error(
      "[auth] idToken kunne ikke krypteres og gemmes ikke:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * databaseHooks.account.{create,update}.before: returnerer kun idToken, som
 * better-auth merger ind i rækken; uden idToken ændres intet.
 */
export async function encryptIdTokenBeforeWrite(account: {
  idToken?: string | null;
}): Promise<{ data: { idToken: string | null | undefined } } | undefined> {
  if (!account.idToken) return undefined;
  return { data: { idToken: protectIdToken(account.idToken) } };
}

/** Læs et gemt idToken (krypteret eller gammel klartekst). Fejl → null. */
export function readStoredIdToken(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch (error) {
    console.error(
      "[auth] gemt idToken kunne ikke dekrypteres:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
