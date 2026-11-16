import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  "/terms",
  "/privacy",
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

  it("giver 404 på marketing via rewrite til en ikke-eksisterende sti", () => {
    selfhost();
    const res = middleware(new NextRequest("http://localhost:3000/pricing"));
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/_marketing-disabled",
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
