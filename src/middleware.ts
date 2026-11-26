import { type NextRequest, NextResponse } from "next/server";
import {
  BRAND_HEADER,
  type BrandHostConfig,
  isMultibrandEnabled,
  LOCALE_HEADER,
  normalizeHost,
  pickLocale,
  resolveAliasHost,
  resolveBrandByHost,
  splitLocalePrefix,
} from "@/lib/brands/registry";
import { isDocsFilePath } from "@/lib/brands/timewren-docs";
import {
  isBrandAppEnabled,
  isSiteInternalPath,
  isTimewrenIndexable,
  routeSite,
  SITE_PREFIX,
} from "@/lib/brands/timewren-site";
import { withReportOnlyCsp } from "@/lib/csp-report-only";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { INSTANCE_PAGES_PREFIX, isInstancePage } from "@/lib/instance-paths";
import {
  CLOUD_DPA_PDF_PATH,
  guardInstanceOnly,
  guardMarketing,
  isInstancePath,
  isTimeTrackCloud,
  usesRuntimeInstancePages,
} from "@/lib/marketing-guard";
import { appUrlEnv, marketingUrlEnv } from "@/lib/runtime-env";

/**
 * Host-based routing for the marketing/app subdomain split.
 *
 * The whole project is a single Next.js deployment served from two hosts:
 *   - timetrack.dk      → marketing, blog, SEO landing pages
 *   - app.timetrack.dk  → /dashboard, auth, onboarding, portal, admin
 *
 * This middleware redirects requests that hit the "wrong" host so old bookmarks
 * and email links still land in the right place:
 *   - marketing host + app path     → app host  (e.g. /dashboard bookmarks)
 *   - app host + marketing path     → marketing host
 *   - app host root "/"             → /dashboard
 *
 * INERT UNTIL CUTOVER: the app and marketing hosts are derived from
 * NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_MARKETING_URL. When they resolve to the
 * same host (as today — both timetrack.dk), this middleware is a no-op, so the
 * code can ship with zero behaviour change. Go-live = set the env vars + rebuild.
 *
 * /api, /_next, /monitoring and static files are excluded by the matcher below,
 * so the auth API and tRPC keep working same-origin on BOTH hosts.
 */

// Path prefixes owned by the authenticated app (served from app.timetrack.dk).
// NOTE: deliberately excludes marketing pages that merely sound app-like —
// /desktop and /kundeportal are SEO landing pages, and /portal is the
// client-facing portal with its own custom-domain handling. They stay on the
// marketing host.
const APP_HOST_ROBOTS_HEADER = { "x-robots-tag": "noindex, nofollow" };

const APP_PREFIXES = [
  "/dashboard",
  "/admin",
  "/login",
  "/register",
  "/auth",
  "/onboarding",
  // Service workerens offline-side: skal kunne precaches fra app-hosten.
  "/offline",
];

function isAppPath(pathname: string): boolean {
  return APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * Multibrand (docs/specs/timewren-cloud.md): kun for ikke-standardbrands.
 * Sætter x-brand/x-brand-locale som request-headers, så server-komponenter kan
 * vælge brand uden at kende hosten, og fjerner sprogpræfikset (/de/x → /x).
 * Headerne fra klienten overskrives altid, så de ikke kan forfalskes.
 */
function multibrandResponse(
  req: NextRequest,
  cfg: BrandHostConfig,
): NextResponse {
  const site = siteResponse(req, cfg);
  if (site) return site;
  // The app on non-default brand hosts is closed until TIMEWREN_APP_ENABLED=1
  // (auth per host: src/lib/auth/host-auth.ts, docs/specs/timewren-cloud.md).
  if (!isBrandAppEnabled()) {
    const res = NextResponse.rewrite(new URL("/_marketing-disabled", req.url));
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }
  // Appen kører kun på brandets primære host (fx timewren.com), samme host
  // som marketing: én baseURL, ét passkey-RP-ID og host-only cookies
  // (src/lib/auth/host-auth.ts). www.- og øvrige hosts sendes dertil.
  const host = normalizeHost(req.headers.get("host"));
  if (host !== cfg.hosts[0]) {
    return NextResponse.redirect(
      `https://${cfg.hosts[0]}${req.nextUrl.pathname}${req.nextUrl.search}`,
      308,
    );
  }
  const { locale: prefixed, rest } = splitLocalePrefix(
    cfg,
    req.nextUrl.pathname,
  );
  const locale =
    prefixed ??
    pickLocale(cfg, {
      cookie: req.cookies.get("locale")?.value,
      acceptLanguage: req.headers.get("accept-language"),
    });
  const headers = new Headers(req.headers);
  headers.set(BRAND_HEADER, cfg.key);
  headers.set(LOCALE_HEADER, locale);

  const guard = guardInstanceOnly(rest);
  if (guard.action === "redirect") {
    const url = req.nextUrl.clone();
    url.pathname = guard.to;
    return NextResponse.redirect(url, 307);
  }
  if (guard.action === "notFound") {
    return NextResponse.rewrite(new URL("/_marketing-disabled", req.url), {
      request: { headers },
    });
  }
  let res: NextResponse;
  if (prefixed) {
    const url = req.nextUrl.clone();
    url.pathname = rest;
    res = NextResponse.rewrite(url, { request: { headers } });
    // Valget huskes, så links uden præfiks bliver i samme sprog.
    res.cookies.set("locale", prefixed, { path: "/", sameSite: "lax" });
  } else {
    res = NextResponse.next({ request: { headers } });
  }
  // Ingen indeksering af TimeWren-hosts, før de har egne marketingsider.
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

/**
 * TimeWrens marketingsite (src/lib/brands/timewren-site.ts): forside, priser,
 * selvhost og juridiske sider på marketinghosten, plus robots.txt og
 * sitemap.xml pr. host. null = ikke en marketingsti; appens logik tager over.
 * Marketingsiderne er indekserbare, medmindre TIMEWREN_INDEXABLE=0.
 */
function siteResponse(
  req: NextRequest,
  cfg: BrandHostConfig,
): NextResponse | null {
  const host = normalizeHost(req.headers.get("host"));
  const route = routeSite(
    cfg,
    host,
    req.nextUrl.pathname,
    req.headers.get("accept"),
  );
  if (route.action === "none") return null;
  if (route.action === "redirect") {
    // Hosten fra Host-headeren (routeSite har tjekket, at det er
    // marketinghosten); nextUrl peger på serverens egen adresse bag proxyen.
    return NextResponse.redirect(
      `https://${host}${route.to}${req.nextUrl.search}`,
      308,
    );
  }
  const headers = new Headers(req.headers);
  headers.set(BRAND_HEADER, cfg.key);
  const target = req.nextUrl.clone();
  if (
    route.action === "page" ||
    route.action === "docs" ||
    route.action === "docs-md"
  ) {
    headers.set(LOCALE_HEADER, route.locale);
    target.pathname = route.to;
  } else {
    headers.set(LOCALE_HEADER, cfg.defaultLocale);
    target.pathname = `${SITE_PREFIX}/${route.action}`;
  }
  const res = NextResponse.rewrite(target, { request: { headers } });
  // Docs-stier har to repræsentationer (HTML og Markdown) valgt af Accept.
  if (route.action === "docs" || route.action === "docs-md") {
    res.headers.set("Vary", "Accept");
  }
  // Markdown, llms.txt og søgning er dubletter af siderne: aldrig i indekset.
  const indexable =
    isTimewrenIndexable() &&
    (route.action === "page" ||
      route.action === "sitemap" ||
      route.action === "docs");
  if (!indexable) res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  // Stricter CSP as report-only on top of the enforced one (#1121).
  return withReportOnlyCsp(
    req,
    isDemoMode() ? demoRequest(req) : routeRequest(req),
  );
}

/**
 * Offentlig demo (DEMO_MODE=1, docs/demo.md): intet må indekseres, og der er
 * ingen almindelig signup; den besøgende starter fra login-siden med "Prøv
 * demoen". Ellers samme routing som altid.
 */
function demoRequest(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain", ...APP_HOST_ROBOTS_HEADER },
    });
  }
  if (pathname === "/register" || pathname.startsWith("/register/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }
  const res = routeRequest(req);
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

function runtimePage(req: NextRequest, path: string) {
  const url = req.nextUrl.clone();
  url.pathname = `${INSTANCE_PAGES_PREFIX}${path}`;
  return NextResponse.rewrite(url);
}

function routeRequest(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (pathname === CLOUD_DPA_PDF_PATH && !isTimeTrackCloud()) {
    return new NextResponse(null, { status: 404 });
  }
  if (
    pathname === INSTANCE_PAGES_PREFIX ||
    pathname.startsWith(`${INSTANCE_PAGES_PREFIX}/`)
  ) {
    return NextResponse.rewrite(new URL("/_marketing-disabled", req.url));
  }
  const runtimePages = usesRuntimeInstancePages();
  // TimeWren-sitets interne sider nås kun via rewrite herfra, aldrig direkte.
  if (isSiteInternalPath(req.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL("/_marketing-disabled", req.url));
  }

  if (isMultibrandEnabled()) {
    const host = req.headers.get("host");
    // Alias-domæner (timewren.org, .io …): 308 til primærdomænet, samme sti og query.
    const alias = resolveAliasHost(host);
    if (alias) {
      return NextResponse.redirect(
        `https://${alias.hosts[0]}${req.nextUrl.pathname}${req.nextUrl.search}`,
        308,
      );
    }
    const cfg = resolveBrandByHost(host);
    if (cfg.key !== "timetrack") return multibrandResponse(req, cfg);
  }

  if (pathname === "/sitemap.xml") {
    return runtimePages ? runtimePage(req, pathname) : NextResponse.next();
  }
  // Det samme for TimeWren-docs' filstier (llms*.txt, *.md): uændret svar.
  if (isDocsFilePath(req.nextUrl.pathname)) return NextResponse.next();

  // Selvhost uden NEXT_PUBLIC_MARKETING_URL: ingen marketingsider.
  // Roden sendes til appen, resten af marketing-stierne giver 404.
  const guard = guardMarketing(req.nextUrl.pathname);
  if (guard.action === "redirect") {
    const url = req.nextUrl.clone();
    url.pathname = guard.to;
    return NextResponse.redirect(url, 307);
  }
  if (guard.action === "notFound") {
    return runtimePage(req, "/not-found");
  }

  const appUrl = appUrlEnv() || "";
  const marketingUrl = marketingUrlEnv() || appUrl;

  const appHost = hostOf(appUrl);
  const marketingHost = hostOf(marketingUrl);

  const runtimeResponse = () =>
    runtimePages &&
    (isInstancePage(pathname) ||
      pathname === "/robots.txt" ||
      (pathname !== "/opengraph-image" && !isInstancePath(pathname)))
      ? runtimePage(req, pathname === "/" ? "" : pathname)
      : NextResponse.next();

  // Feature disabled when unconfigured or both hosts are identical.
  if (!appHost || !marketingHost || appHost === marketingHost) {
    return runtimeResponse();
  }

  const host = req.headers.get("host") || "";
  const { search } = req.nextUrl;

  // 308 (permanent) by default: the split is settled, and search engines
  // must move signals to the right host. Set SUBDOMAIN_REDIRECT_STATUS=307
  // to fall back to temporary redirects.
  const status = process.env.SUBDOMAIN_REDIRECT_STATUS === "307" ? 307 : 308;

  const onAppHost = host === appHost;
  const onMarketingHost =
    host === marketingHost || host === `www.${marketingHost}`;
  const appPath = isAppPath(pathname);

  // The app subdomain must stay out of the index. Crawling is allowed so
  // search engines can see the X-Robots-Tag noindex and the permanent
  // redirects to the marketing host — a disallow-all robots.txt kept
  // app.timetrack.dk/ indexed as a bare URL. (Next statically prerenders the
  // robots metadata route, so it can't be made host-aware; the middleware
  // always sees the real host.) The marketing host keeps its own robots.ts.
  if (onAppHost && pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nAllow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain", ...APP_HOST_ROBOTS_HEADER },
    });
  }

  // Old bookmark / email link to an app path on the marketing host → app host.
  if (onMarketingHost && appPath) {
    return NextResponse.redirect(
      `https://${appHost}${pathname}${search}`,
      status,
    );
  }

  // Marketing path (or bare root) requested on the app host → marketing host.
  if (onAppHost && !appPath) {
    if (pathname === "/") {
      // Keep the query string (utm/ref attribution) across the redirect.
      return NextResponse.redirect(
        `https://${appHost}/dashboard${search}`,
        status,
      );
    }
    return NextResponse.redirect(
      `https://${marketingHost}${pathname}${search}`,
      status,
    );
  }

  if (onAppHost) {
    return NextResponse.next({ headers: APP_HOST_ROBOTS_HEADER });
  }

  return runtimeResponse();
}

export const config = {
  // Exclude API (shared on both hosts), Next internals, the Sentry tunnel and
  // any file with an extension (static assets). /robots.txt is added back
  // explicitly so the middleware can serve the app-host disallow-all variant.
  matcher: [
    "/((?!api/|_next/|monitoring|.well-known/|.*\\.[\\w]+$).*)",
    "/robots.txt",
    "/instance-pages/robots.txt",
    "/instance-pages/sitemap.xml",
    "/sitemap.xml",
    "/install.sh",
    "/timewren-site/install.sh",
    // TimeWren-docs (timewren-docs.ts): stier med filendelse, som den
    // første regel udelader. Alle andre hosts får uændret svar.
    "/llms.txt",
    "/llms-full.txt",
    "/((?:[a-z]{2}/)?docs(?:/[a-z0-9/-]*)?\\.md)",
  ],
};
