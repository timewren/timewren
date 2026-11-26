/**
 * Kontrakten for `extension.integrations.exportOptions`: desktop parser
 * svaret, så nøglerne pr. system er låst her. Web's procedurer er erstattet
 * af faste svar med web's egne outputtyper (`RouterOutputs`), så tsc fanger
 * det, hvis web ændrer form; de rigtige kald mod Billy, Dinero og e-conomic
 * kræver nøgler og dækkes ikke her. Vagterne (modul, ikke forbundet) står i
 * paritet.dbtest.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { RouterOutputs } from "../../index";

type Web = RouterOutputs["integrations"];

const web = vi.hoisted(() => ({
  integrations: {} as Record<string, () => Promise<unknown>>,
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("../device-procedure", async () => {
  const { publicProcedure } = await import("../../../trpc");
  return {
    deviceProcedure: publicProcedure.use(({ ctx, next }) =>
      next({ ctx: { ...ctx, web } }),
    ),
  };
});

const billyProducts: Web["getBillyProducts"] = {
  products: [
    { id: "p1", name: "Konsulent", description: "Timer", productNo: "100" },
  ],
  defaultProductId: "p1",
};
const billyLine: Web["getBillyLineSettings"] = {
  lineType: "combined",
  lineTemplate: "{{beskrivelse}}",
};
const dineroAccounts: Web["getDineroAccounts"] = [
  {
    accountNumber: 1000,
    name: "Salg",
    vatCode: "U25",
    isDefaultSalesAccount: true,
  },
];
const dineroLine: Web["getDineroLineSettings"] = {
  lineType: "per_entry",
  lineTemplate: "{{beskrivelse}}",
  defaultAccountNumber: 1000,
};
const economicProducts: Web["getEconomicProducts"] = [
  {
    productNumber: "E1",
    name: "Rådgivning",
    description: "Timer",
    salesPrice: 900,
  },
];
const economicLayouts: Web["getEconomicLayouts"] = [
  { layoutNumber: 19, name: "Standard" },
];
const economicTerms: Web["getEconomicPaymentTerms"] = [];
const economicLine: Web["getEconomicLineSettings"] = {
  lineType: "per_entry",
  lineTemplate: "{{beskrivelse}}",
  defaultLayoutNumber: 19,
  defaultPaymentTermsNumber: null,
};

Object.assign(web.integrations, {
  getBillyProducts: async () => billyProducts,
  getBillyLineSettings: async () => billyLine,
  getDineroAccounts: async () => dineroAccounts,
  getDineroLineSettings: async () => dineroLine,
  getEconomicProducts: async () => economicProducts,
  getEconomicLayouts: async () => economicLayouts,
  getEconomicPaymentTerms: async () => economicTerms,
  getEconomicLineSettings: async () => economicLine,
});

const { extIntegrationsRouter } = await import("../integrations");
const caller = extIntegrationsRouter.createCaller({
  session: null,
  db: {},
  headers: new Headers(),
} as never);
const exportOptions = (system: "billy" | "dinero" | "economic") =>
  caller.exportOptions({ token: "t", system } as never);

describe("extension.integrations.exportOptions (kontrakt)", () => {
  it("billy: produkter og standardprodukt + linjeindstillinger", async () => {
    expect(await exportOptions("billy")).toEqual({
      products: [{ id: "p1", name: "Konsulent" }],
      defaults: {
        productId: "p1",
        lineType: "combined",
        lineTemplate: "{{beskrivelse}}",
      },
    });
  });

  it("dinero: indtægtskonti med kontonummer som streng-id", async () => {
    expect(await exportOptions("dinero")).toEqual({
      products: [{ id: "1000", name: "Salg" }],
      defaults: {
        lineType: "per_entry",
        lineTemplate: "{{beskrivelse}}",
        defaultAccountNumber: 1000,
      },
    });
  });

  it("economic: produkter, standarder, layouts og betalingsbetingelser", async () => {
    expect(await exportOptions("economic")).toEqual({
      products: [{ id: "E1", name: "Rådgivning" }],
      defaults: {
        lineType: "per_entry",
        lineTemplate: "{{beskrivelse}}",
        defaultLayoutNumber: 19,
        defaultPaymentTermsNumber: null,
      },
      layouts: [{ layoutNumber: 19, name: "Standard" }],
      paymentTerms: [],
    });
  });
});
