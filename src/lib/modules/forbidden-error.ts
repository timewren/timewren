/**
 * Genkender FORBIDDEN-fejlen fra guardedRouter (src/lib/trpc/module-guard.ts):
 * (`data.appCode === "MODULE_DISABLED"`, sprogneutral: beskeden er oversat). Skelner fra andre
 * FORBIDDEN-fejl (fx rolle-baserede fra RoleModuleGuard), som har andre
 * beskeder og skal vises som en almindelig adgangsfejl, ikke "modul slukket".
 */

interface ModuleForbiddenErrorLike {
  data?: { code?: string; appCode?: string } | null;
  message?: string;
}

export function isModuleDisabledError(
  error: ModuleForbiddenErrorLike | null | undefined,
): boolean {
  return (
    error?.data?.code === "FORBIDDEN" &&
    error.data.appCode === "MODULE_DISABLED"
  );
}
