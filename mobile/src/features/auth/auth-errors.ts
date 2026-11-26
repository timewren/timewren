import type { TxKeyPath } from '~/lib/i18n';
import { translate } from '~/lib/i18n';

/** Fejlobjektet better-auth returnerer i `{ error }`. */
export type AuthError = { code?: string; message?: string; status?: number };

/**
 * better-auths fejlkoder → appens egne tekster. Serverens `message` er engelsk
 * ("Invalid email or password") og blev før vist direkte i en dansk app.
 */
const CODE_KEYS: Record<string, TxKeyPath> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.errors.invalid_credentials',
  INVALID_PASSWORD: 'auth.errors.invalid_credentials',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'auth.errors.invalid_credentials',
  USER_NOT_FOUND: 'auth.errors.invalid_credentials',
  EMAIL_NOT_VERIFIED: 'auth.errors.email_not_verified',
  USER_ALREADY_EXISTS: 'auth.errors.user_exists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.errors.user_exists',
  INVALID_EMAIL: 'auth.errors.invalid_email',
  PASSWORD_TOO_SHORT: 'auth.errors.password_too_short',
  PASSWORD_TOO_LONG: 'auth.errors.password_too_long',
  INVALID_CODE: 'auth.errors.invalid_code',
  INVALID_BACKUP_CODE: 'auth.errors.invalid_code',
  OTP_HAS_EXPIRED: 'auth.errors.code_expired',
  INVALID_TWO_FACTOR_COOKIE: 'auth.errors.code_expired',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'auth.errors.too_many_attempts',
  ACCOUNT_TEMPORARILY_LOCKED: 'auth.errors.too_many_attempts',
};

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network request failed|failed to fetch/i.test(error.message));
}

/** Dansk (eller engelsk) tekst til en login-/oprettelsesfejl. Ukendte fejl får den generelle tekst. */
export function authErrorMessage(error: unknown): string {
  if (isNetworkFailure(error))
    return translate('auth.errors.network');
  const { code, status } = (error ?? {}) as AuthError;
  if (code && CODE_KEYS[code])
    return translate(CODE_KEYS[code]);
  if (status === 429)
    return translate('auth.errors.too_many_attempts');
  return translate('auth.error_generic');
}
