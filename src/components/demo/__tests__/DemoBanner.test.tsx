import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import da from "@/i18n/messages/da/demo.json";
import { DemoBanner } from "../DemoBanner";

afterEach(() => vi.unstubAllEnvs());

const render = (messages: Record<string, unknown>) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="da" messages={messages}>
      <DemoBanner />
    </NextIntlClientProvider>,
  );

describe("DemoBanner", () => {
  it("viser besked og links i demo-tilstand", () => {
    vi.stubEnv("DEMO_MODE", "1");
    const html = render({ demo: da });
    expect(html).toContain(
      "Demo: dine data slettes efter 24 timer, og der sendes ingen mails.",
    );
    expect(html).toContain("https://github.com/timewren/timewren");
    expect(html).toContain("https://timewren.com/docs/install/quick");
    // Kan ikke lukkes: eneste knap er rundvisningen
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("tilbyder rundvisningen, som ikke starter af sig selv i demoen (#1213)", () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(render({ demo: da })).toMatch(/<button[^>]*>[^<]*Se en rundvisning/);
  });

  it("renderer intet uden DEMO_MODE, også uden demo-tekster", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(render({})).toBe("");
  });
});
