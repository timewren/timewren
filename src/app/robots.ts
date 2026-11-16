import type { MetadataRoute } from "next";
import { getMarketingUrl } from "@/lib/config";
import { isMarketingEnabled } from "@/lib/marketing-guard";

// Samme private stier for alle crawlere: app, auth og API skal aldrig
// crawles, uanset hvem der spørger.
const PRIVATE_PATHS = [
  "/admin/",
  "/api/",
  "/auth/",
  "/dashboard/",
  "/login/",
  "/register/",
  "/portal/",
];

// AI-crawlere er nævnt eksplicit (#701). Marketing-sitet er offentligt
// salgsmateriale, og vi vil gerne citeres, når nogen spørger en AI om
// tidsregistrering, klippekort eller fakturering. Derfor tillades både
// søge-/svarcrawlere (OAI-SearchBot, ChatGPT-User, Claude-SearchBot,
// Claude-User, PerplexityBot, Perplexity-User) og træningscrawlere (GPTBot,
// ClaudeBot, Google-Extended, Applebot-Extended, CCBot) på de offentlige
// sider. De private stier er spærret præcis som for alle andre.
// Skal en crawler holdes ude senere, flyttes den til en egen regel med
// disallow: "/".
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

// This static robots serves the MARKETING host (timetrack.dk). On the app
// host (app.timetrack.dk) the middleware intercepts /robots.txt and returns
// Disallow: / directly — Next statically prerenders metadata routes, so
// host-detection here can't be relied on after the subdomain split.
export default function robots(): MetadataRoute.Robots {
  // Selvhostet instans uden marketingsider: intet at indeksere (#968).
  if (!isMarketingEnabled()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const marketingUrl = getMarketingUrl();

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: `${marketingUrl}/sitemap.xml`,
  };
}
