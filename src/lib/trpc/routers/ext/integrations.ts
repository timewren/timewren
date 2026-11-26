import { z } from "zod";
import { router } from "../../trpc";
import { deviceProcedure } from "./device-procedure";

/**
 * Regnskabsprogrammer for token-klienter: hvilke der er forbundet, og hvad
 * eksport-dialogen skal vælge imellem. Eksporten selv er
 * `extension.invoices.exportTo*`. Alt er web's procedurer (integrations-
 * modulet og brugerens egne nøgler); ext-laget giver kun én fælles form.
 */
export const extIntegrationsRouter = router({
  /** Som web's knapper på fakturaen (user.getIntegrationStatus). */
  status: deviceProcedure.query(async ({ ctx }) => {
    const s = await ctx.web.user.getIntegrationStatus();
    return {
      billy: s.billyConnected,
      dinero: s.dineroConnected,
      economic: s.economicConnected,
    };
  }),

  /**
   * Valgmuligheder til eksport-dialogen, som web's eksport-modaler:
   * `products` (Billy: produkter, Dinero: indtægtskonti, e-conomic:
   * produkter) og `defaults` (standardprodukt/-konto og linjeindstillinger).
   * e-conomic har også `layouts` og `paymentTerms`. Ikke forbundet =
   * web's BAD_REQUEST.
   */
  exportOptions: deviceProcedure
    .input(z.object({ system: z.enum(["billy", "dinero", "economic"]) }))
    .query(async ({ ctx, input }) => {
      const integrations = ctx.web.integrations;
      if (input.system === "billy") {
        const [{ products, defaultProductId }, line] = await Promise.all([
          integrations.getBillyProducts(),
          integrations.getBillyLineSettings(),
        ]);
        return {
          products: products.map((p) => ({ id: p.id, name: p.name })),
          defaults: { productId: defaultProductId, ...line },
        };
      }
      if (input.system === "dinero") {
        const [accounts, line] = await Promise.all([
          integrations.getDineroAccounts(),
          integrations.getDineroLineSettings(),
        ]);
        return {
          products: accounts.map((a) => ({
            id: String(a.accountNumber),
            name: a.name,
          })),
          defaults: line,
        };
      }
      const [products, layouts, paymentTerms, line] = await Promise.all([
        integrations.getEconomicProducts(),
        integrations.getEconomicLayouts(),
        integrations.getEconomicPaymentTerms(),
        integrations.getEconomicLineSettings(),
      ]);
      return {
        products: products.map((p) => ({ id: p.productNumber, name: p.name })),
        defaults: line,
        layouts,
        paymentTerms,
      };
    }),
});
