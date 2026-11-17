import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import da from "@/i18n/messages/da/demo.json";

const params = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => params.value }));
vi.mock("@/components/auth/DashboardBackdrop", () => ({
  DashboardBackdrop: () => null,
}));
vi.mock("@/components/auth/LocaleSwitcher", () => ({
  LocaleSwitcher: () => null,
}));
vi.mock("@/components/BrandContext", () => ({ BrandLogo: () => null }));

import { DemoLogin } from "../DemoLogin";

const render = (query = "") => {
  params.value = new URLSearchParams(query);
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="da" messages={{ demo: da }}>
      <DemoLogin />
    </NextIntlClientProvider>,
  );
};

describe("DemoLogin", () => {
  it("er en formular-POST til /api/demo/start uden almindeligt login", () => {
    const html = render();
    expect(html).toContain('action="/api/demo/start"');
    expect(html).toContain('method="post"');
    expect(html).toContain("Prøv demoen");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('role="alert"');
  });

  it("viser en venlig besked, når demoen er fuld eller begrænset", () => {
    expect(render("demo=full")).toContain(da.login.errors.full);
    expect(render("demo=rate_limited")).toContain(da.login.errors.rate_limited);
    // Ukendte koder vises ikke
    expect(render("demo=<script>")).not.toContain('role="alert"');
  });
});
