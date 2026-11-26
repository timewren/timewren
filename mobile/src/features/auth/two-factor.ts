import type { AuthError } from './auth-errors';
import { authClient } from '~/lib/auth/client';

/** Godkendelsesapp, kode på mail eller en af backupkoderne. */
export type TwoFactorMode = 'totp' | 'otp' | 'backup';

/**
 * Kontoen har tofaktor slået til: `signIn.email` svarer uden fejl, men også
 * uden session, med `twoFactorRedirect`. Før endte det i "Kunne ikke hente din
 * session", og en bruger med tofaktor kunne slet ikke logge ind i appen — på
 * TimeWren, hvor adgangskode er eneste vej ind, var der ingen omvej.
 */
export function twoFactorMethods(data: unknown): string[] | null {
  const d = data as { twoFactorRedirect?: boolean; twoFactorMethods?: unknown } | null | undefined;
  if (!d?.twoFactorRedirect)
    return null;
  return Array.isArray(d.twoFactorMethods) ? d.twoFactorMethods.filter((m): m is string => typeof m === 'string') : [];
}

/** Appen først, når kontoen har en; ellers mailkoden. Ældre servere sender ingen metoder: så appen. */
export function initialTwoFactorMode(methods: readonly string[]): TwoFactorMode {
  return methods.includes('totp') || !methods.includes('otp') ? 'totp' : 'otp';
}

/** Mellemrum fra kopiering fjernes; backupkoder beholder deres bindestreger. */
export function normalizeTwoFactorCode(mode: TwoFactorMode, code: string): string {
  return mode === 'backup' ? code.trim() : code.replace(/\s/g, '');
}

/** Bekræft koden. Ved succes sætter serveren sessionscookien. */
export async function verifyTwoFactorCode(mode: TwoFactorMode, code: string): Promise<AuthError | null> {
  const input = { code: normalizeTwoFactorCode(mode, code) };
  const result = mode === 'totp'
    ? await authClient.twoFactor.verifyTotp(input)
    : mode === 'otp'
      ? await authClient.twoFactor.verifyOtp(input)
      : await authClient.twoFactor.verifyBackupCode(input);
  return result.error ?? null;
}

export async function sendTwoFactorEmail(): Promise<AuthError | null> {
  const result = await authClient.twoFactor.sendOtp();
  return result.error ?? null;
}
