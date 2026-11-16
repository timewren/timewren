import { z } from "zod";
import { router } from "../../trpc";
import { deviceProcedure } from "./device-procedure";

/**
 * CVR-opslag for token-klienter (desktop kundeformular). Klienten kalder
 * aldrig CVR-tjenesten selv: nøglen ligger kun i web's server-env. Begge
 * procedurer er læsninger (query), så de tæller ikke med i
 * skrivegrænsen, men går via web's `integrations.*` og dermed web's egen
 * CVR-rate limit pr. bruger. Uden tjenestenøgle falder opslaget tilbage til
 * cvrapi.dk, som i web.
 */
export const extCvrRouter = router({
  /**
   * Ét CVR-nummer (8 cifre, mellemrum tilladt). Web's `cvrLookup` oversætter
   * selv CvrLookupError til NOT_FOUND, TOO_MANY_REQUESTS osv.
   */
  lookup: deviceProcedure
    .input(z.object({ cvrNumber: z.string().min(8).max(20) }))
    .query(({ ctx, input }) =>
      ctx.web.integrations.cvrLookup({
        cvrNumber: input.cvrNumber.replace(/\D/g, ""),
      }),
    ),

  /** Navneforslag (højst `limit`, standard 8). Et CVR-nummer giver højst ét træf. */
  search: deviceProcedure
    .input(
      z.object({
        query: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(10).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.web.integrations.cvrSuggest({
        query: input.query,
        limit: input.limit,
      }),
    ),
});
