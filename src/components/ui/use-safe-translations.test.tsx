import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useSafeTranslations } from "./use-safe-translations";

const da = { buy: { label: "Køb licens ({price} kr)" } };

function Label() {
  const t = useSafeTranslations("desktop", da);
  return <span>{t("buy.label", { price: 499 })}</span>;
}

describe("useSafeTranslations", () => {
  it("bruger de danske tekster uden udbyder", () => {
    expect(renderToString(<Label />)).toContain("Køb licens (499 kr)");
  });

  // Marketingsiderne har en udbyder med kun "forms" (layout.tsx), og
  // /desktop viste derfor nøglen "desktop.buy.label" på købsknappen.
  it("bruger de danske tekster, når udbyderen mangler navneområdet", () => {
    const html = renderToString(
      <NextIntlClientProvider
        locale="da"
        messages={{ forms: {} }}
        onError={() => {}}
      >
        <Label />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Køb licens (499 kr)");
    expect(html).not.toContain("desktop.buy.label");
  });

  it("bruger udbyderens tekster, når navneområdet findes", () => {
    const html = renderToString(
      <NextIntlClientProvider
        locale="en"
        messages={{ desktop: { buy: { label: "Buy licence ({price})" } } }}
      >
        <Label />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Buy licence (499)");
  });
});
