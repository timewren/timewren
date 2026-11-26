import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { guardMarketing, isMarketingEnabled } from "./marketing-guard";

const MARKETING_PATHS = [
  "/pricing",
  "/blog",
  "/blog/noget",
  "/lp/google-ads",
  "/selvstaendig",
  "/clockify-alternativ",
  "/features",
  "/faq",
];
const APP_PATHS = [
  "/dashboard",
  "/dashboard/clients",
  "/login",
  "/login/two-factor",
  "/register",
  "/auth/forgot-password",
  "/onboarding",
  "/portal/login",
  "/r/abc",
  "/cookies",
  "/privacy",
  "/terms",
  "/slet-konto",
  "/contact",
  "/gdpr",
  "/databehandleraftale",
  "/download",
  "/download/success",
  "/admin",
];

function selfhost() {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("marketing-guard", () => {
  it("er slået til for TimeTrack Cloud (brandet i testmiljøet)", () => {
    expect(isMarketingEnabled()).toBe(true);
    for (const p of ["/", ...MARKETING_PATHS, ...APP_PATHS]) {
      expect(guardMarketing(p)).toEqual({ action: "next" });
    }
  });

  it("er slået fra for TimeWren uden NEXT_PUBLIC_MARKETING_URL", () => {
    selfhost();
    expect(isMarketingEnabled()).toBe(false);
    expect(guardMarketing("/")).toEqual({
      action: "redirect",
      to: "/dashboard",
    });
    for (const p of MARKETING_PATHS) {
      expect(guardMarketing(p)).toEqual({ action: "notFound" });
    }
    for (const p of APP_PATHS) {
      expect(guardMarketing(p)).toEqual({ action: "next" });
    }
  });

  it("requires explicit marketing opt-in on a self-hosted TimeTrack domain", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://instance.example");
    expect(guardMarketing("/pricing")).toEqual({ action: "notFound" });
    expect(guardMarketing("/")).toEqual({
      action: "redirect",
      to: "/dashboard",
    });
    expect(guardMarketing("/privacy")).toEqual({ action: "next" });
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://www.instance.example");
    expect(guardMarketing("/pricing")).toEqual({ action: "next" });
  });

  it("er slået fra i selfhost-profilen, også med NEXT_PUBLIC_MARKETING_URL", () => {
    vi.stubEnv("BUILD_PROFILE", "selfhost");
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timewren.example");
    expect(isMarketingEnabled()).toBe(false);
    expect(guardMarketing("/")).toEqual({
      action: "redirect",
      to: "/dashboard",
    });
    expect(guardMarketing("/pricing")).toEqual({ action: "notFound" });
    expect(guardMarketing("/cookies")).toEqual({ action: "next" });
  });

  it("lader ikke et præfiks-lignende marketingnavn slippe igennem", () => {
    selfhost();
    expect(guardMarketing("/rabat")).toEqual({ action: "notFound" });
    expect(guardMarketing("/dashboards")).toEqual({ action: "notFound" });
  });

  it("er slået til for TimeWren, når NEXT_PUBLIC_MARKETING_URL er sat", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timewren.example");
    expect(isMarketingEnabled()).toBe(true);
    expect(guardMarketing("/pricing")).toEqual({ action: "next" });
  });

  it("er slået fra, når NEXT_PUBLIC_BRAND mangler helt", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
    expect(isMarketingEnabled()).toBe(false);
  });
});

describe("middleware på selvhost", () => {
  it("sender roden til /dashboard og bevarer query", () => {
    selfhost();
    const res = middleware(new NextRequest("http://localhost:3000/?ref=x"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/dashboard?ref=x",
    );
  });

  it("giver 404 med instansens brand på blokerede marketingsider", () => {
    selfhost();
    const res = middleware(new NextRequest("http://localhost:3000/pricing"));
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/instance-pages/not-found",
    );
  });

  it("lader app-stier passere", () => {
    selfhost();
    const res = middleware(new NextRequest("http://localhost:3000/login"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("serverer link-preview-billedet, som metadata peger på", () => {
    selfhost();
    const res = middleware(
      new NextRequest("http://localhost:3000/opengraph-image"),
    );
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    expect(guardMarketing("/opengraph-image/x")).toEqual({
      action: "notFound",
    });
  });

  it("rører ikke marketing på TimeTrack Cloud", () => {
    const res = middleware(new NextRequest("http://localhost:3000/pricing"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("runtime instance HTML", () => {
  it.each([
    "/cookies",
    "/contact",
    "/gdpr",
    "/privacy",
    "/terms",
    "/databehandleraftale",
    "/download",
    "/download/success",
    "/slet-konto",
  ])("renders %s at request time while keeping the public URL", (path) => {
    selfhost();
    const res = middleware(
      new NextRequest(`https://instance.example${path}?ref=x`),
    );
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      `https://instance.example/instance-pages${path}?ref=x`,
    );
  });

  it.each(["/robots.txt", "/sitemap.xml"])(
    "uses the runtime app's %s",
    (path) => {
      selfhost();
      const res = middleware(
        new NextRequest(`https://instance.example${path}`),
      );
      expect(res.headers.get("x-middleware-rewrite")).toBe(
        `https://instance.example/instance-pages${path}`,
      );
    },
  );

  it.each(["/cookies", "/robots.txt", "/sitemap.xml"])(
    "keeps the prerendered %s on TimeTrack Cloud",
    (path) => {
      const res = middleware(new NextRequest(`https://timetrack.dk${path}`));
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    },
  );

  it("prevents direct access to the internal rendering route", () => {
    const res = middleware(
      new NextRequest("https://timetrack.dk/instance-pages/cookies"),
    );
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/_marketing-disabled",
    );
  });
});

it("preserves beta Cloud marketing without a separate marketing host", () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://beta.timetrack.dk");
  for (const path of ["/", "/pricing", "/privacy"]) {
    expect(guardMarketing(path)).toEqual({ action: "next" });
  }
});

it("renders opted-in marketing at runtime on self-hosted domains", () => {
  selfhost();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://instance.example");
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://instance.example");
  for (const path of ["/", "/pricing", "/blog/klippekort-skabelon"]) {
    const res = middleware(new NextRequest(`https://instance.example${path}`));
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      `https://instance.example/instance-pages${path === "/" ? "" : path}`,
    );
  }
});
