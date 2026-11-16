import { marketingUrlEnv } from "@/lib/runtime-env";
import { getBrandId } from "./brand-id";

/**
 * Marketingsiderne (forside, priser, blog, /lp, segmenter, sammenligninger,
 * juridiske sider) er TimeTrack Clouds egen hjemmeside og hører ikke til på en
 * selvhostet instans (#968). Ét sted afgør, om de er slået til, og hvilke
 * stier der hører til selve appen. Bruges af middleware.ts.
 *
 * Slået til når brandet er TimeTrack (Cloud), eller når en selvhoster
 * eksplicit har sat NEXT_PUBLIC_MARKETING_URL (egen hjemmeside på samme
 * kodebase). Uden begge: kun appen.
 */
export function isMarketingEnabled(): boolean {
  return getBrandId() === "timetrack" || Boolean(marketingUrlEnv());
}

/**
 * Stier, der er appen selv (også når marketing er slået fra). Alt andet er
 * marketing. Allowlist, så en ny marketingside er lukket som standard på
 * selvhost. /api og statiske filer når aldrig hertil (middleware-matcheren).
 */
const INSTANCE_PREFIXES = [
  "/dashboard",
  "/admin",
  "/login",
  "/register",
  "/auth",
  "/onboarding",
  "/offline",
  // Kundeportalen og delte rapporter er appens egne flader.
  "/portal",
  "/r",
  // Sider, appen selv linker til (cookiebanner, indstillinger, fejlsider og
  // Stripe-retur for desktop-køb). Ellers giver linkene 404 på selvhost.
  "/cookies",
  "/contact",
  "/gdpr",
  "/databehandleraftale",
  "/download",
];

export function isInstancePath(pathname: string): boolean {
  return INSTANCE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export type MarketingGuardResult =
  | { action: "next" }
  | { action: "redirect"; to: string }
  | { action: "notFound" };

/**
 * Afgør hvad der sker med en forespørgsel, når marketing er slået fra:
 * roden sendes til dashboardet (som sender uloggede videre til login), andre
 * marketingstier giver 404.
 */
export function guardMarketing(pathname: string): MarketingGuardResult {
  if (isMarketingEnabled()) return { action: "next" };
  return guardInstanceOnly(pathname);
}

/** Kun appens egne stier; bruges også for TimeWren-hosts, der endnu ikke har marketingsider. */
export function guardInstanceOnly(pathname: string): MarketingGuardResult {
  if (pathname === "/") return { action: "redirect", to: "/dashboard" };
  // /opengraph-image: link-preview-billedet, som metadata peger på for alle
  // brands (DocumentLayout). Uden det giver delte app-links intet preview.
  if (
    isInstancePath(pathname) ||
    pathname === "/robots.txt" ||
    pathname === "/opengraph-image"
  ) {
    return { action: "next" };
  }
  return { action: "notFound" };
}
