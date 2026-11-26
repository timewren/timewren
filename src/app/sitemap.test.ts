import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seoPagePaths } from "@/lib/marketing/arbejdsdage-seo";
import sitemap from "./sitemap";

/**
 * Drift-test: sitemap.ts er en manuelt kurateret liste, og nye offentlige
 * sider blev historisk glemt (fx /developers og /integrations/*). Denne test
 * sammenligner filsystemets offentlige routes med sitemappet, så drift
 * fejler i CI i stedet for at blive opdaget måneder senere i GSC.
 *
 * En ny offentlig side skal enten tilføjes i src/app/sitemap.ts eller —
 * hvis den bevidst skal holdes ude (kampagne-LP, transaktionel side) —
 * i EXCLUDED_FROM_SITEMAP nedenfor.
 */

// Route-præfikser der ikke er offentlig marketing (app, auth, api m.m.).
const PRIVATE_PREFIXES = [
  "dashboard",
  "admin",
  "api",
  "auth",
  "login",
  "register",
  "portal",
  "onboarding",
  "invite",
  "accept-invitation",
  "verify",
  "reset-password",
  "forgot-password",
  "magic-link",
  "two-factor",
  "desktop-auth",
];

// Offentlige sider der BEVIDST holdes ude af sitemappet.
const EXCLUDED_FROM_SITEMAP = new Set([
  "/offline", // PWA-fallback
  "/download/success", // transaktionel kvitteringsside
  "/desktop/license", // købs-undersider uden SEO-værdi
  "/desktop/refund",
  "/fra-linkedin", // kampagne-landing page (trafik styres via links)
]);

function collectPublicRoutes(appDir: string): string[] {
  const routes: string[] = [];
  const walk = (dir: string, urlPath: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) {
        if (entry === "page.tsx" && urlPath !== "") {
          routes.push(urlPath);
        }
        continue;
      }
      // Route-grupper påvirker filstien, men ikke sidens URL.
      if (entry.startsWith("[")) continue;
      walk(full, entry.startsWith("(") ? urlPath : `${urlPath}/${entry}`);
    }
  };
  walk(appDir, "");
  return routes.filter((route) => {
    const first = route.split("/")[1];
    return !PRIVATE_PREFIXES.includes(first);
  });
}

describe("sitemap drift", () => {
  const appDir = resolve(__dirname);
  const publicRoutes = collectPublicRoutes(appDir);
  let sitemapPaths: Set<string>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
    sitemapPaths = new Set(
      sitemap().map((entry) => {
        const url = new URL(entry.url);
        return url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
      }),
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it("alle offentlige sider er i sitemappet (eller eksplicit undtaget)", () => {
    const missing = publicRoutes.filter(
      (route) => !sitemapPaths.has(route) && !EXCLUDED_FROM_SITEMAP.has(route),
    );
    expect(
      missing,
      `Mangler i src/app/sitemap.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("sitemappet peger ikke på sider der ikke findes", () => {
    // Månedssiderne ligger i [maaned]-mapper, som route-gennemgangen springer over.
    const known = new Set([
      ...publicRoutes,
      "/",
      "/llms.txt",
      ...seoPagePaths(),
    ]);
    const stale = [...sitemapPaths].filter((path) => !known.has(path));
    expect(stale, `Døde sitemap-indgange: ${stale.join(", ")}`).toEqual([]);
  });

  it("indeholder alle programmatiske arbejdsdage-sider", () => {
    const missing = seoPagePaths().filter((p) => !sitemapPaths.has(p));
    expect(missing).toEqual([]);
  });

  it("eksplicit undtagne sider findes stadig (ellers er undtagelsen død)", () => {
    const gone = [...EXCLUDED_FROM_SITEMAP].filter(
      (route) => !publicRoutes.includes(route),
    );
    expect(gone).toEqual([]);
  });
});
