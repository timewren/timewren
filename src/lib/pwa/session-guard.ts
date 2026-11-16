/**
 * Skal dashboardet logge brugeren ud, fordi sessionen mangler?
 *
 * Kun når serveren faktisk har sagt det: et svar uden session eller en 401.
 * Uden net (koldstart i den installerede app) eller ved netværks- og
 * serverfejl er sessionen bare ukendt — et logout her ville smide brugeren
 * ud til en login-side, der heller ikke virker offline.
 */
export function shouldSignOutForMissingSession(args: {
  online: boolean;
  errorStatus: number | null | undefined;
  hasError?: boolean;
}): boolean {
  if (!args.online) return false;
  if (args.errorStatus === 401) return true;
  return !args.hasError;
}

/** Ventetid før næste forsøg på at hente sessionen: 2 s, 4 s, 8 s … maks 60 s. */
export function sessionRetryDelay(attempt: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, attempt), 60_000);
}
