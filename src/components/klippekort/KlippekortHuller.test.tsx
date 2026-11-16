import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadMessages } from "@/i18n/messages/load";
import { KlippekortHuller } from "./KlippekortHuller";

const messages = await loadMessages("da");

const render = (total: number, remaining: number) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="da" messages={messages}>
      <KlippekortHuller totalHours={total} remainingHours={remaining} />
    </NextIntlClientProvider>,
  );

describe("KlippekortHuller", () => {
  it("har en tilgængelig tekst med saldoen som tilbage", () => {
    const html = render(20, 7);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="7 t tilbage af 20"');
    expect(html.match(/data-hul="brugt"/g)).toHaveLength(13);
    expect(html.match(/data-hul="tom"/g)).toHaveLength(7);
  });

  it("nævner skalaen i aria-label, når 1 hul = 5 t", () => {
    const html = render(50, 17.5);
    expect(html).toContain('aria-label="17,5 t tilbage af 50 (1 hul = 5 t)"');
    expect(html.match(/data-hul="halv"/g)).toHaveLength(1);
  });

  it("viser bjælke for meget store kort", () => {
    const html = render(300, 150);
    expect(html).not.toContain("data-hul");
    expect(html).toContain("width:50%");
  });
});
