import { z } from "zod";
import { router } from "../../trpc";
import { deviceProcedure, type WebInputs, webInput } from "./device-procedure";

/**
 * Rapporter for token-klienter: tid pr. kunde, projekt, opgave, dag, uge
 * eller måned i en periode, med web's rapport-logik (afrunding, klippekort,
 * hvem der må se hvis tid) og web's eksport (csv, xlsx, json, pdf).
 * `config` er web's rapportskabelon (filters, grouping, columns, branding).
 */
export const extReportsRouter = router({
  get: deviceProcedure
    .input(
      z.object({
        config: webInput<WebInputs["reports"]["getReportData"]["config"]>(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.web.reports.getReportData({ config: input.config }),
    ),

  export: deviceProcedure
    .input(
      z.object({
        config: webInput<WebInputs["reports"]["exportReport"]["config"]>(),
        format: z.enum(["csv", "xlsx", "json", "pdf"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.reports.exportReport({
        config: input.config,
        format: input.format,
      }),
    ),
});
