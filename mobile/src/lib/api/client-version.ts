import Env from 'env';
import * as Application from 'expo-application';
import { create } from 'zustand';

/**
 * Klientversion mod serveren (web PR #781).
 *
 * Alle kald sender `x-timetrack-client: mobile/<version>+<build>`, fx
 * `mobile/1.0.0+5`. Build-nummeret SKAL være numerisk — serveren sammenligner
 * det med minimummet i `MIN_CLIENT_VERSIONS`. Er en skrivning for gammel,
 * svarer tRPC `PRECONDITION_FAILED` (412) med `data.appCode = "CLIENT_TOO_OLD"`.
 * Læsninger og login afvises aldrig.
 */
export const CLIENT_HEADER = 'x-timetrack-client';
export const CLIENT_TOO_OLD = 'CLIENT_TOO_OLD';

/** `1.0.0` + `5` → `mobile/1.0.0+5`. Uden numerisk build kun versionen. */
export function formatMobileClientVersion(version: string, build: string | null | undefined): string {
  const b = build?.trim();
  return b && /^\d+$/.test(b) ? `mobile/${version}+${b}` : `mobile/${version}`;
}

/**
 * Versionen fra app.config (= package.json, samme som binæren — appen har
 * ingen OTA-opdateringer) + det native build-nummer (ios.buildNumber /
 * android.versionCode = APP_BUILD_NUMBER).
 */
export const CLIENT_VERSION = formatMobileClientVersion(Env.EXPO_PUBLIC_VERSION, Application.nativeBuildVersion);

export function clientVersionHeaders(): Record<string, string> {
  return { [CLIENT_HEADER]: CLIENT_VERSION };
}

/** Sand når serveren afviste kaldet, fordi appen er under minimumsversionen. */
export function isClientTooOld(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('data' in error))
    return false;
  const data = (error as { data?: { appCode?: unknown } | null }).data;
  return data?.appCode === CLIENT_TOO_OLD;
}

type ClientTooOldState = { tooOld: boolean };

/** Sat første gang serveren svarer CLIENT_TOO_OLD — viser den blokerende besked. */
export const useClientTooOld = create<ClientTooOldState>(() => ({ tooOld: false }));

export function markClientTooOld(): void {
  if (!useClientTooOld.getState().tooOld)
    useClientTooOld.setState({ tooOld: true });
}

/** De skrivninger serveren versionstjekker, som appen kalder (web: `isGuardedWritePath`). */
export function isGuardedWrite(path: string, type: string): boolean {
  return type === 'mutation' && (path.startsWith('time.') || path.startsWith('timerSync.'));
}

/**
 * En beskyttet skrivning gik igennem (fx køens genforsøg, efter at serveren
 * har sænket minimummet): appen er ikke længere blokeret, så beskeden lukkes.
 */
export function clearClientTooOld(): void {
  if (useClientTooOld.getState().tooOld)
    useClientTooOld.setState({ tooOld: false });
}
