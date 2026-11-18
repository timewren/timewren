import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import forms from "@/i18n/messages/en/forms.json";
import { seoTools } from "@/lib/marketing/seo-tools";
import { MarketingIntlProvider } from "./MarketingIntlProvider";
import { SeoCalculator } from "./SeoCalculator";

it("renders calculator fields, results and units in the provider locale", () => {
  const html = renderToStaticMarkup(
    <MarketingIntlProvider locale="en" messages={{ forms }}>
      <SeoCalculator
        calculation="rounding"
        fields={seoTools.rounding.fields}
        results={seoTools.rounding.results}
      />
    </MarketingIntlProvider>,
  );

  expect(html).toContain(">Whole hours</label>");
  expect(html).toContain(">Rounded time</dt>");
  expect(html).toContain(">75 minutes</dd>");
});
