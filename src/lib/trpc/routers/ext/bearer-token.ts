import { publicProcedure } from "../../trpc";

/**
 * Tokenet i `Authorization: Bearer <token>` (desktop 0.2.24, review-fund
 * #16). En tRPC-query er en GET, så et token i input står i `?input=` og
 * dermed i proxy- og adgangslogs. Mangler `token` i input, lægges headerens
 * token ind, før input valideres. Et token i input vinder, så udvidelsen
 * virker som før.
 */
export function bearerToken(headers: Headers | null | undefined): string {
  const header = headers?.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** `publicProcedure`, hvor input-feltet `token` kan komme fra headeren. */
export const tokenProcedure = publicProcedure.use(
  async ({ ctx, getRawInput, next }) => {
    const bearer = bearerToken(ctx.headers);
    if (!bearer) return next();
    return next({
      getRawInput: async () => {
        const raw = await getRawInput();
        if (raw === undefined || raw === null) return { token: bearer };
        if (typeof raw !== "object" || Array.isArray(raw)) return raw;
        const { token } = raw as { token?: unknown };
        return token ? raw : { ...raw, token: bearer };
      },
    });
  },
);
