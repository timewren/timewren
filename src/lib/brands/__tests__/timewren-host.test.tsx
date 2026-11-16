import { NextRequest } from "next/server";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/globals.css", () => ({}));
vi.mock("next/font/google", () => ({
  Geist_Mono: () => ({ variable: "mono" }),
  Schibsted_Grotesk: () => ({ variable: "sans" }),
}));

const h = vi.hoisted(() => ({ headers: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([...h.headers]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { render } from "@react-email/render";
import { WelcomeEmail } from "@/components/email/WelcomeEmail";
import { mailBrandFor } from "@/lib/email/mail-brand";
import { renderEmail } from "@/lib/email/render-email";
import { middleware } from "@/middleware";
import { getRequestBrand } from "../request";

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: { host: new URL(url).host, ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  // Appen på TimeWren-hosts er spærret som standard; disse tests dækker den åbne app.
  vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
  h.headers = new Map();
});
afterEach(() => vi.unstubAllEnvs());

describe("TimeWren-host", () => {
  it("middleware sætter brand og sprog fra Accept-Language", () => {
    const res = middleware(
      req("https://timewren.com/login", { "accept-language": "de-DE,de" }),
    );
    expect(res.headers.get("x-middleware-request-x-brand")).toBe("timewren");
    expect(res.headers.get("x-middleware-request-x-brand-locale")).toBe("de");
  });

  it("sti-præfiks vinder, omskrives og huskes i cookie", () => {
    const res = middleware(
      req("https://timewren.com/es/login", { "accept-language": "de" }),
    );
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "https://timewren.com/login",
    );
    expect(res.headers.get("x-middleware-request-x-brand-locale")).toBe("es");
    expect(res.cookies.get("locale")?.value).toBe("es");
  });

  it("klient-sat x-brand overskrives", () => {
    const res = middleware(
      req("https://timewren.com/login", { "x-brand": "timetrack" }),
    );
    expect(res.headers.get("x-middleware-request-x-brand")).toBe("timewren");
  });

  it("TimeTracks marketingsider lækker ikke til TimeWren-hosten", () => {
    const res = middleware(req("https://timewren.com/klippekort"));
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/_marketing-disabled",
    );
  });

  it("timetrack-host får ingen brand-headers", () => {
    const res = middleware(req("https://timetrack.dk/dashboard"));
    expect(res.headers.get("x-middleware-request-x-brand")).toBeNull();
  });

  it("getRequestBrand: TimeWren-host giver TimeWren-brand og sprog", async () => {
    h.headers = new Map([
      ["host", "app.timewren.com"],
      ["x-brand-locale", "de"],
    ]);
    const rb = await getRequestBrand();
    expect(rb.brand.name).toBe("TimeWren");
    expect(rb.locale).toBe("de");
    expect(rb.host?.currency).toBe("EUR");
    expect(rb.baseUrl).toBe("https://timewren.com");
  });

  it("getRequestBrand: forfalsket x-brand på timetrack-host ændrer intet", async () => {
    h.headers = new Map([
      ["host", "timetrack.dk"],
      ["x-brand", "timewren"],
      ["x-brand-locale", "de"],
    ]);
    const rb = await getRequestBrand();
    expect(rb.brand.name).toBe("TimeTrack");
    expect(rb.locale).toBe("da");
  });

  it("flag fra: altid build-brandet, uden at læse headers", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    h.headers = new Map([["host", "timewren.com"]]);
    const rb = await getRequestBrand();
    expect(rb.host).toBeNull();
  });

  it("i18n: de-sprog med engelsk fallback, kun brandets sprog", async () => {
    const { default: cfg } = await import("@/i18n/request");
    h.headers = new Map([
      ["host", "timewren.com"],
      ["x-brand-locale", "de"],
    ]);
    const r = await (
      cfg as unknown as () => Promise<{
        locale: string;
        messages: {
          common: { save: string; cancel: string };
          serverErrors: { tasks: { invalidOrder: string } };
        };
      }>
    )();
    expect(r.locale).toBe("de");
    expect(r.messages.common.save).toBe("Speichern");
    // en-fallback: en nøgle, der (endnu) ikke er oversat til tysk.
    expect(r.messages.serverErrors.tasks.invalidOrder).toBe("Invalid order");
  });

  it("mail: TimeWren har eget navn, afsender, logo og links; ingen TimeTrack", async () => {
    const mb = mailBrandFor("timewren");
    expect(mb.from).toContain("TimeWren");
    const { html } = await renderEmail(
      createElement(WelcomeEmail, {
        userName: "Mette",
        dashboardUrl: mb.dashboardUrl,
        mailBrand: mb,
      }),
    );
    expect(html).toContain("TimeWren");
    expect(html).not.toContain("TimeTrack");
    expect(html).not.toContain("timetrack.dk");
    expect(html).toContain("timewren.com/brand/timewren/mark-64.png");
  });
});

describe("TimeWren-velkomstmail pr. sprog", () => {
  it("tysk og dansk tekst følger mailBrand.locale", async () => {
    const mb = mailBrandFor("timewren");
    for (const [locale, word] of [
      ["de", "Willkommen"],
      ["en", "Welcome"],
      ["es", "Bienvenido"],
    ] as const) {
      const html = await render(
        createElement(WelcomeEmail, {
          userName: "Anna",
          mailBrand: { ...mb, locale },
        }),
      );
      expect(html).toContain(word);
      expect(html).not.toContain("Velkommen");
    }
  });
});
