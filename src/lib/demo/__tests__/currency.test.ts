import { createTranslator } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import type invoicesCatalog from "@/i18n/messages/en/invoices.json";
import type settingsCatalog from "@/i18n/messages/en/settings.json";
import { loadMessages } from "@/i18n/messages/load";
import {
  dkkCurrencyFormatter,
  formatCurrency,
  formatHourlyRate,
} from "@/lib/format";
import { demoCurrencyMessages } from "../currency-messages";
import { demoCurrencyForEmail } from "../demo-mode";
import { runWithDemoCurrency } from "../server-currency";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ["EUR", "1.234,50 EUR", "95 EUR/h", "€95"],
  ["DKK", "1.234,50 DKK", "95 DKK/h", "DKK 95"],
])(
  "formats %s amounts using the browser account currency",
  (currency, total, hourly, symbol) => {
    vi.stubGlobal("window", { __TT_CONFIG__: { demo: true } });
    vi.stubGlobal("document", {
      documentElement: { dataset: { demoCurrency: currency } },
    });

    expect(formatCurrency(1234.5, { locale: "de", decimals: 2 })).toBe(total);
    expect(formatHourlyRate(95, "en")).toBe(hourly);
    expect(dkkCurrencyFormatter.format(95, "en")).toBe(symbol);
  },
);

it("keeps currency local to a demo account on the server", async () => {
  vi.stubEnv("DEMO_MODE", "1");
  await Promise.all([
    runWithDemoCurrency("demo-eur-123456789abc@demo.invalid", async () => {
      await Promise.resolve();
      expect(formatCurrency(95, { locale: "en" })).toBe("95 EUR");
    }),
    runWithDemoCurrency("demo-123456789abc@demo.invalid", async () => {
      await Promise.resolve();
      expect(formatCurrency(800, { locale: "en" })).toBe("800 DKK");
    }),
  ]);
  expect(demoCurrencyForEmail("demo-eur-123456789abc@example.com")).toBe("DKK");
  expect(formatCurrency(800, { locale: "en" })).toBe("800 DKK");
});

type CurrencyMessages = {
  invoices: typeof invoicesCatalog;
  settings: typeof settingsCatalog;
};

it("translates the actual profile and invoice labels for EUR accounts", async () => {
  const original = (await loadMessages("en")) as CurrencyMessages;
  const messages = demoCurrencyMessages(original, "EUR") as CurrencyMessages;
  const settings = createTranslator({
    locale: "en",
    messages,
    namespace: "settings",
  });
  const invoices = createTranslator({
    locale: "en",
    messages,
    namespace: "invoices",
  });
  expect(settings("profile.hourlyRate")).toBe("Default hourly rate (EUR)");
  expect(settings("profile.rateInvalid")).toContain("EUR");
  expect(invoices("detail.amountKr", { amount: "1,234.50" })).toBe(
    "1,234.50 EUR",
  );
  expect(demoCurrencyMessages(original, "DKK")).toBe(original);
  const legacy = createTranslator({
    locale: "en",
    messages: original,
    namespace: "settings",
  });
  expect(legacy("profile.hourlyRate")).toBe("Default hourly rate (kr)");
});
