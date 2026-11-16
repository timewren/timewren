import type { AnyRouter } from "@trpc/server";
import { tr } from "@/i18n/server-text";
import type { ModuleKey } from "@/lib/modules/constants";
import { appCodeError } from "./app-code";
import type { ModulesContext } from "./routers/enterprise/middleware";

/**
 * Wrap a router so every procedure inside it requires a given module to be
 * enabled. Throws FORBIDDEN if the active org does not have the module.
 *
 * Context must include `modules: ModulesContext` — typically provided by
 * `organizationProcedure` or `isAuthed` middleware that resolves modules.
 *
 * Implementation note: tRPC 11 procedure middlewares are stored in
 * `_def.procedures` (aliased as `_def.record`) as a flat map. Each procedure's
 * builder stores its middlewares in `_def.middlewares`. The chain for a
 * `protectedProcedure.query(resolver)` is `[isAuthed, resolverWrapper]`.
 * We insert the guard at `length - 1` (i.e. immediately before the
 * resolver-calling middleware) so execution order becomes:
 *   isAuthed → guard → resolver
 * This ensures `ctx.modules` has been populated before the guard reads it.
 *
 * `except` names procedures that must stay reachable without the module (fx
 * en brugers egen dataeksport, som ikke må afhænge af rapport-modulet).
 */
export function guardedRouter<TRouter extends AnyRouter>(
  moduleKey: ModuleKey,
  innerRouter: TRouter,
  options: { except?: readonly string[] } = {},
): TRouter {
  const except = new Set(options.except ?? []);
  // Access procedures via the runtime shape. tRPC v11 stores them under
  // `_def.procedures` at runtime (same object as `_def.record`).
  const procedures = (
    innerRouter._def as unknown as {
      procedures: Record<
        string,
        {
          _def: {
            middlewares: Array<
              (opts: {
                ctx: { modules?: ModulesContext };
                next: (opts: unknown) => unknown;
                [key: string]: unknown;
              }) => unknown
            >;
          };
        }
      >;
    }
  ).procedures;

  for (const name of Object.keys(procedures)) {
    if (except.has(name)) continue;
    const proc = procedures[name];
    if (!proc?._def?.middlewares) continue;
    const middlewares = proc._def.middlewares;

    const guardMiddleware = async (opts: {
      ctx: { modules?: ModulesContext };
      next: (opts: unknown) => unknown;
      [key: string]: unknown;
    }) => {
      const modules = opts.ctx?.modules;
      // No modules context — this is a publicProcedure (isAuthed never ran
      // and so ctx.modules was never populated). The procedure must do its
      // own auth (token / signature / etc.); we pass through instead of
      // throwing FORBIDDEN. The guard still enforces the module whenever
      // ctx.modules IS present, which covers all protected procedures.
      if (modules && !modules.isEnabled(moduleKey)) {
        throw appCodeError(
          "FORBIDDEN",
          "MODULE_DISABLED",
          await tr("serverErrors", "core.moduleDisabled", {
            module: moduleKey,
          }),
        );
      }
      return opts.next(opts);
    };

    // Insert the guard immediately before the resolver-calling middleware
    // (which is always the last entry in the chain), but AFTER any auth
    // middleware (isAuthed) so that ctx.modules has been populated.
    const insertAt = Math.max(0, middlewares.length - 1);
    middlewares.splice(insertAt, 0, guardMiddleware);
  }

  return innerRouter;
}
