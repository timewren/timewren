import { type TRPC_ERROR_CODE_KEY, TRPCError } from "@trpc/server";

/**
 * Sprogneutral markør på en TRPCError. Serverbeskeder er oversat til kaldets
 * sprog, så klienten må aldrig matche på teksten; errorFormatter lægger koden
 * i `data.appCode`.
 */
export type AppErrorCode = "MODULE_DISABLED" | "PLAN_TIER_REQUIRED";

class AppCodeCause extends Error {
  constructor(readonly appCode: AppErrorCode) {
    super(appCode);
    this.name = "AppCodeCause";
  }
}

export function appCodeError(
  code: TRPC_ERROR_CODE_KEY,
  appCode: AppErrorCode,
  message: string,
): TRPCError {
  return new TRPCError({ code, message, cause: new AppCodeCause(appCode) });
}

export function appCodeOf(err: unknown): AppErrorCode | null {
  const cause = err instanceof Error ? err.cause : null;
  return cause instanceof Error && cause.name === "AppCodeCause"
    ? (cause as AppCodeCause).appCode
    : null;
}
