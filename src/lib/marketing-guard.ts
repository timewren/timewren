import {
  appUrlEnv,
  marketingUrlEnv,
  runtimeBuildMismatches,
} from "@/lib/runtime-env";
import { getBrandId } from "./brand-id";
import { getBrandConfigs } from "./brands/registry";
import { isInstancePage } from "./instance-paths";

/**
 * Marketingsiderne (forside, priser, blog, /lp, segmenter, sammenligninger,
 * juridiske sider) er TimeTrack Clouds egen hjemmeside og hører ikke til på en
 * selvhostet instans (#968). Ét sted afgør, om de er slået til, og hvilke
 * stier der hører til selve appen. Bruges af middleware.ts.
 *
 * En selvhostet instans skal aktivere marketing med NEXT_PUBLIC_MARKETING_URL.
 */
export function isMarketingEnabled(): boolean {
  // The selfhost build profile leaves the marketing group out (#1100), so
  // NEXT_PUBLIC_MARKETING_URL has nothing to enable.
  if (process.env.BUILD_PROFILE === "selfhost") return false;
  return isTimeTrackCloud() || Boolean(marketingUrlEnv());
}

/**
 * Mahope's own domain and every subdomain of it (app, beta, staging, ...) is
 * TimeTrack Cloud. Nobody else can serve an instance from timetrack.dk, so a
 * new environment there never needs to be added to a host list.
 */
const CLOUD_DOMAIN = "timetrack.dk";

export function isTimeTrackCloud(): boolean {
  const appHost = URL.parse(appUrlEnv() ?? "")?.hostname;
  return (
    getBrandId() === "timetrack" &&
    Boolean(
      appHost &&
        (appHost === CLOUD_DOMAIN ||
          appHost.endsWith(`.${CLOUD_DOMAIN}`) ||
          getBrandConfigs("").timetrack.hosts.includes(appHost)),
    )
  );
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
];

export const CLOUD_DPA_PDF_PATH = "/databehandleraftale/pdf";

export function isInstancePath(pathname: string): boolean {
  return (
    isInstancePage(pathname) ||
    (pathname === CLOUD_DPA_PDF_PATH && isTimeTrackCloud()) ||
    INSTANCE_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  );
}

/** Keep cloud marketing prerendered when runtime and build settings agree. */
export function usesRuntimeInstancePages(): boolean {
  return !isTimeTrackCloud() || runtimeBuildMismatches().length > 0;
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
