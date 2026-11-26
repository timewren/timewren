import {
  activeDemoCurrency,
  DEMO_CURRENCY,
  type DemoCurrency,
} from "./demo-mode";

const namespaces = [
  "calendar",
  "clients",
  "dashboard",
  "invoices",
  "klippekort",
  "projects",
  "reports",
  "settings",
  "settingsRates",
  "timer",
];
const cache = new WeakMap<Record<string, unknown>, Record<string, unknown>>();

export function withDemoCurrency(text: string): string {
  return activeDemoCurrency() === DEMO_CURRENCY
    ? replaceCurrencyLabel(text)
    : text;
}

/** Keep exported amounts numeric and identify EUR in their column headers. */
export function withDemoCurrencyUnit(label: string): string {
  return activeDemoCurrency() === DEMO_CURRENCY
    ? `${label} (${DEMO_CURRENCY})`
    : label;
}

function replaceCurrencyLabel(text: string): string {
  return text.replace(/\b(?:DKK\b|kr\b\.?)/g, DEMO_CURRENCY);
}

function replaceCurrency(value: unknown): unknown {
  if (typeof value === "string") {
    return replaceCurrencyLabel(value);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, message]) => [
        key,
        replaceCurrency(message),
      ]),
    );
  }
  return value;
}

/** Some dashboard messages include the currency alongside an interpolated amount. */
export function demoCurrencyMessages(
  messages: Record<string, unknown>,
  currency: DemoCurrency,
) {
  if (currency !== DEMO_CURRENCY) return messages;
  const cached = cache.get(messages);
  if (cached) return cached;

  const demo = { ...messages };
  for (const namespace of namespaces) {
    if (namespace in messages)
      demo[namespace] = replaceCurrency(messages[namespace]);
  }
  cache.set(messages, demo);
  return demo;
}
